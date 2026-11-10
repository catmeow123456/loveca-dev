import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { BladeHeartEffect, HeartColor } from '../../../../shared/types/enums.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';
import { PL_AD1_001_LIVE_START_WAITING_ORANGE_TO_FIFTH_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { moveWaitingRoomCardToDeckPositionAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

export const PL_AD1_001_SELECT_ORANGE_TO_FIFTH_STEP_ID =
  'PL_AD1_001_SELECT_WAITING_ORANGE_TO_FIFTH';
type Continue = (game: GameState, ordered: boolean) => GameState;

function candidates(game: GameState, playerId: string, sequence?: unknown): readonly string[] {
  return selectWaitingRoomCardIds(
    game,
    playerId,
    (card) =>
      (isLiveCardData(card.data) || isMemberCardData(card.data)) &&
      card.data.bladeHearts?.some(
        (heart) => heart.effect === BladeHeartEffect.HEART && heart.heartColor === HeartColor.ORANGE
      ) === true
  ).filter(
    (id) => sequence === undefined || !hasWaitingRoomSelectionReenteredAfter(game, [id], sequence)
  );
}

export function registerPlAd1001HonokaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    PL_AD1_001_SELECT_ORANGE_TO_FIFTH_STEP_ID,
    (game, input, context) => {
      const effect = game.activeEffect;
      if (
        !effect ||
        !input.selectedCardId ||
        effect.selectableCardIds?.includes(input.selectedCardId) !== true
      )
        return game;
      const current = candidates(
        game,
        effect.controllerId,
        effect.metadata?.waitingSelectionSequence
      );
      if (!current.includes(input.selectedCardId)) {
        if (current.length === 0)
          return finish(game, effect, context.continuePendingCardEffects, {
            step: 'NO_CURRENT_ORANGE_TARGET',
          });
        return { ...game, activeEffect: { ...effect, selectableCardIds: current } };
      }
      const moved = moveWaitingRoomCardToDeckPositionAndEnqueueTriggers(
        game,
        effect.controllerId,
        input.selectedCardId,
        {
          candidateCardIds: current,
          positionFromTop: 5,
          cause: {
            kind: 'CARD_EFFECT',
            playerId: effect.controllerId,
            sourceCardId: effect.sourceCardId,
            abilityId: effect.abilityId,
            pendingAbilityId: effect.id,
          },
        }
      );
      return moved
        ? finish(moved.gameState, effect, context.continuePendingCardEffects, {
            step: 'PLACE_WAITING_ORANGE_AT_FIFTH',
            movedCardId: moved.movedCardId,
            positionFromTop: moved.positionFromTop,
            insertIndex: moved.insertIndex,
          })
        : game;
    },
    queryCardSelection
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = candidates(game, player.id);
  if (selectableCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: '休息室没有持有[オレンジブレード]的卡片，不放置卡片。',
    });
    if (confirmation) return confirmation;
    return next(
      addAction(
        { ...game, pendingAbilities: game.pendingAbilities.filter((a) => a.id !== ability.id) },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'NO_WAITING_ORANGE_TARGET',
        }
      ),
      options.orderedResolution === true
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PL_AD1_001_SELECT_ORANGE_TO_FIFTH_STEP_ID,
      stepText: '请选择休息室中1张持有[オレンジブレード]的卡片，放置于自己的卡组顶第5张。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      autoSubmitSingleSelection: true,
      selectionLabel: '选择要放置于卡组顶第5张的卡片',
      confirmSelectionLabel: '放置于卡组顶第5张',
      canSkipSelection: false,
      metadata: {
        orderedResolution: options.orderedResolution === true,
        waitingSelectionSequence: game.eventLog.at(-1)?.sequence ?? 0,
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_POSITION_5',
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_WAITING_ORANGE_TO_FIFTH',
      selectableCardIds,
    },
  });
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
