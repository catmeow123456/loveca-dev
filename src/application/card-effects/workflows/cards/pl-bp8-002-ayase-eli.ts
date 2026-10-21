import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import {
  getStageMemberCardIdsMatching,
  memberOriginalHeartLte,
} from '../../../effects/stage-targets.js';
import { PL_BP8_002_AUTO_LEAVE_STAGE_BOTTOM_SELF_WAIT_ORIGINAL_HEART_FOUR_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isLeaveStageSourceStillInWaitingRoom } from '../../runtime/leave-stage-source.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ACTIVATE_STEP = 'PL_BP8_002_ACTIVATE_BOTTOM_SELF';
const SELECT_TARGET_STEP = 'PL_BP8_002_SELECT_OPPONENT_ORIGINAL_HEART_FOUR_MEMBER';
const targetPredicate = memberOriginalHeartLte(4);
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8002AyaseEliWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const orderedResolution = options.orderedResolution === true;
    if (!isSourceAvailable(game, ability)) {
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'SOURCE_WAITING_ROOM_OBJECT_UNAVAILABLE',
          }
        ),
        orderedResolution
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: ACTIVATE_STEP,
        stepText:
          '可以将此卡放置于卡组底。如此做时，将对方舞台上1名原本持有的HEART数量小于等于4的成员变为待机状态。',
        awaitingPlayerId: ability.controllerId,
        selectableOptions: [{ id: 'activate', label: '发动' }],
        confirmSelectionLabel: '发动',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: { orderedResolution, leaveStageEventIds: ability.eventIds },
      },
      actionPayload: { step: 'START_BOTTOM_SELF_OPTION' },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    ACTIVATE_STEP,
    (game, input, context) => {
      if (input.selectedCardId != null || (input.selectedCardIds?.length ?? 0) > 0) return game;
      if (input.selectedOptionId == null) {
        return finish(game, context.continuePendingCardEffects, 'DECLINE_BOTTOM_SELF');
      }
      if (input.selectedOptionId !== 'activate') return game;
      return bottomSelf(game, context.continuePendingCardEffects);
    },
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_TARGET_STEP,
    (game, input, context) => {
      const effect = game.activeEffect;
      const selected = input.selectedCardId;
      if (!effect || !selected || !effect.selectableCardIds?.includes(selected)) return game;
      const opponent = getOpponent(game, effect.controllerId);
      const lifecycle = (
        effect.metadata?.targetLifecycles as Readonly<Record<string, string>> | undefined
      )?.[selected];
      const legal =
        opponent &&
        lifecycle === getStageMemberLifecycleId(game, selected) &&
        getStageMemberCardIdsMatching(
          game,
          opponent.id,
          typeIs(CardType.MEMBER),
          targetPredicate
        ).includes(selected);
      const change = legal
        ? resolveStageMemberOrientationTargetSelection(game, effect, selected)
        : null;
      if (!change?.changed) {
        return finish(game, context.continuePendingCardEffects, 'STALE_TARGET_NO_OP');
      }
      const result = enqueueMemberStateChangedTriggersFromOrientationResult(
        game,
        change,
        deps.enqueueTriggeredCardEffects,
        {
          prepareGameStateBeforeEnqueue: (state) =>
            addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
              pendingAbilityId: effect.id,
              abilityId: ABILITY_ID,
              sourceCardId: effect.sourceCardId,
              step: 'WAIT_OPPONENT_MEMBER',
              targetCardId: selected,
            }),
        }
      );
      return context.continuePendingCardEffects(
        result.gameState,
        effect.metadata?.orderedResolution === true
      );
    },
    queryCardSelection
  );
}

function bottomSelf(game: GameState, continuation: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  const eventIds = effect.metadata?.leaveStageEventIds;
  const ability: PendingAbilityState = {
    id: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LEAVE_STAGE,
    eventIds: Array.isArray(eventIds)
      ? eventIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
  if (!isSourceAvailable(game, ability)) {
    return finish(game, continuation, 'SOURCE_WAITING_ROOM_OBJECT_UNAVAILABLE');
  }
  const move = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    effect.controllerId,
    [effect.sourceCardId],
    {
      candidateCardIds: [effect.sourceCardId],
      minCount: 1,
      maxCount: 1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!move || move.movedCardIds.length !== 1) return game;
  const moved = addAction(move.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'BOTTOM_SELF',
    movedCardIds: move.movedCardIds,
  });
  const opponent = getOpponent(moved, effect.controllerId);
  if (!opponent) return finish(moved, continuation, 'BOTTOM_SELF_NO_TARGET');
  const selection = createStageMemberOrientationTargetSelection(moved, {
    ability,
    effectText: effect.effectText,
    stepId: SELECT_TARGET_STEP,
    stepText: '请选择对方舞台上1名原本持有的HEART数量小于等于4的成员变为待机状态。',
    awaitingPlayerId: effect.controllerId,
    targetPlayerId: opponent.id,
    selector: typeIs(CardType.MEMBER),
    statePredicate: targetPredicate,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: effect.metadata?.orderedResolution === true,
  });
  if (!selection.activeEffect) return finish(moved, continuation, 'BOTTOM_SELF_NO_TARGET');
  return {
    ...moved,
    activeEffect: {
      ...selection.activeEffect,
      metadata: {
        ...selection.activeEffect.metadata,
        targetLifecycles: Object.fromEntries(
          selection.selectableCardIds.map((id) => [id, getStageMemberLifecycleId(moved, id)])
        ),
      },
    },
  };
}

function isSourceAvailable(game: GameState, ability: PendingAbilityState): boolean {
  const card = getCardById(game, ability.sourceCardId);
  return Boolean(
    card &&
    card.ownerId === ability.controllerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!-bp8-002') &&
    isLeaveStageSourceStillInWaitingRoom(game, ability)
  );
}

function finish(game: GameState, continuation: Continue, step: string): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}
