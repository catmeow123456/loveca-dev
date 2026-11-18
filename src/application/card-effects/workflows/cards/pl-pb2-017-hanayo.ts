import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getCardsBelowSourceMember } from '../../../../domain/rules/member-below-queries.js';
import { isMemberEffectActivationProhibited } from '../../../../domain/rules/member-effect-activation-prohibitions.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB2_017_LIVE_START_DISCARD_BELOW_REPEAT_MEMBER_STATE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveCardsBelowSourceMemberToWaitingRoomAndEnqueueTriggers } from '../../runtime/member-below-movement.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_BELOW = 'PL_PB2_017_SELECT_BELOW_TO_WAITING_ROOM';
const SELECT_MEMBER = 'PL_PB2_017_SELECT_PRINTEMPS_MEMBER';
const printempsMember = and(typeIs(CardType.MEMBER), unitAliasIs('Printemps'));
type Continue = (game: GameState, ordered: boolean) => GameState;
type SourceContext = PendingAbilityState | ActiveEffectState;
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlPb2017HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const ordered = options.orderedResolution === true;
    if (!sourceIsCurrent(game, ability))
      return finish(
        game,
        ability,
        ordered,
        context.continuePendingCardEffects,
        'SOURCE_NOT_ON_STAGE'
      );
    const ids = getCardsBelowSourceMember(game, ability.controllerId, ability.sourceCardId);
    if (ids.length === 0) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ABILITY_ID)}\n（当前此成员下方有0张卡片，不进行成员状态改变。）`,
      });
      if (confirmation) return confirmation;
      return finish(
        game,
        ability,
        ordered,
        context.continuePendingCardEffects,
        'NO_CARDS_BELOW_SOURCE'
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: belowSelection(game, ability, ids, ordered),
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'SELECT_BELOW_TO_WAITING_ROOM',
        selectableCardIds: ids,
      },
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_BELOW, (game, input, context) => {
    const effect = getCardActiveEffect(game)!;
    const ordered = effect.metadata?.orderedResolution === true;
    if (!sourceIsCurrent(game, effect))
      return finish(
        game,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'SOURCE_NOT_ON_STAGE'
      );
    const selected = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
    if (selected.length === 0)
      return finish(game, effect, ordered, context.continuePendingCardEffects, 'DECLINED');
    const ids = getCardsBelowSourceMember(game, effect.controllerId, effect.sourceCardId);
    if (ids.length === 0)
      return finish(
        game,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'NO_CARDS_BELOW_SOURCE'
      );
    if (
      selected.length > 3 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !ids.includes(id) || !effect.selectableCardIds?.includes(id))
    ) {
      const stale =
        ids.length !== effect.selectableCardIds?.length ||
        ids.some((id, i) => effect.selectableCardIds?.[i] !== id);
      return stale ? { ...game, activeEffect: belowSelection(game, effect, ids, ordered) } : game;
    }
    const movement = moveCardsBelowSourceMemberToWaitingRoomAndEnqueueTriggers(
      game,
      {
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        selectedCardIds: selected,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: effect.controllerId,
          sourceCardId: effect.sourceCardId,
          abilityId: ABILITY_ID,
          pendingAbilityId: effect.id,
        },
      },
      deps.enqueueTriggeredCardEffects
    );
    if (!movement) return game;
    const state = addAction(movement.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_BELOW_CARDS_TO_WAITING_ROOM',
      movedCardIds: movement.movedCardIds,
      enterWaitingRoomEventId: movement.enterWaitingRoomEvent?.eventId ?? null,
    });
    return selectNextMember(
      state,
      {
        ...effect,
        metadata: {
          orderedResolution: ordered,
          remainingChanges: movement.movedCardIds.length,
        },
      },
      context.continuePendingCardEffects
    );
  });
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MEMBER, (game, input, context) => {
    const effect = getCardActiveEffect(game)!;
    const ids = getChangeablePrintempsMemberIds(game, effect.controllerId);
    if (ids.length === 0)
      return finish(
        game,
        effect,
        effect.metadata?.orderedResolution === true,
        context.continuePendingCardEffects,
        'NO_CHANGEABLE_PRINTEMPS_TARGET'
      );
    if (input.selectedOptionId != null || input.selectedCardIds != null) return game;
    const target = input.selectedCardId;
    if (!target || !effect.selectableCardIds?.includes(target)) return game;
    const targetLifecycleIds = effect.metadata?.targetLifecycleIds as
      Readonly<Record<string, string>> | undefined;
    if (
      !ids.includes(target) ||
      targetLifecycleIds?.[target] !== getStageMemberLifecycleId(game, target)
    )
      return selectNextMember(game, effect, context.continuePendingCardEffects);
    const currentOrientation = getPlayerById(game, effect.controllerId)!.memberSlots.cardStates.get(
      target
    )!.orientation;
    const orientation =
      currentOrientation === OrientationState.ACTIVE
        ? OrientationState.WAITING
        : OrientationState.ACTIVE;
    const result = setMemberOrientation(game, effect.controllerId, target, orientation, {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: ABILITY_ID,
      pendingAbilityId: effect.id,
    });
    if (!result?.changed) return selectNextMember(game, effect, context.continuePendingCardEffects);
    const state = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      result,
      deps.enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (current, change, events) =>
          addAction(current, 'RESOLVE_ABILITY', effect.controllerId, {
            pendingAbilityId: effect.id,
            abilityId: ABILITY_ID,
            sourceCardId: effect.sourceCardId,
            step: 'CHANGE_PRINTEMPS_MEMBER_STATE',
            targetMemberCardId: target,
            previousOrientation: change.previousOrientation,
            nextOrientation: change.nextOrientation,
            changed: change.changed,
            memberStateChangedEventIds: events.map((event) => event.eventId),
          }),
      }
    ).gameState;
    return selectNextMember(
      state,
      {
        ...effect,
        metadata: {
          ...effect.metadata,
          remainingChanges: getRemaining(effect) - 1,
        },
      },
      context.continuePendingCardEffects
    );
  });
}

function sourceIsCurrent(game: GameState, context: SourceContext): boolean {
  const source = getCardById(game, context.sourceCardId);
  return (
    source !== null &&
    source.ownerId === context.controllerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-017') &&
    getSourceMemberSlot(game, context.controllerId, context.sourceCardId) !== null &&
    (context.sourceLifecycleId === undefined ||
      context.sourceLifecycleId ===
        getAbilitySourceLifecycleId(game, ABILITY_ID, context.sourceCardId))
  );
}

function belowSelection(
  game: GameState,
  context: SourceContext,
  ids: readonly string[],
  ordered: boolean
): ActiveEffectState {
  return {
    id: context.id,
    abilityId: ABILITY_ID,
    sourceCardId: context.sourceCardId,
    sourceLifecycleId:
      context.sourceLifecycleId ??
      getAbilitySourceLifecycleId(game, ABILITY_ID, context.sourceCardId),
    controllerId: context.controllerId,
    awaitingPlayerId: context.controllerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: SELECT_BELOW,
    stepText:
      '可以选择此成员下方至多3张卡片放置入休息室。每放置1张，随后选择1名『Printemps』成员改变状态：活跃状态变为待机状态，待机状态变为活跃状态。',
    selectableCardIds: ids,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: 0,
    maxSelectableCards: Math.min(3, ids.length),
    selectionLabel: '选择要放置入休息室的下方卡片',
    confirmSelectionLabel: '放置入休息室',
    canSkipSelection: true,
    skipSelectionLabel: '不发动',
    metadata: { orderedResolution: ordered },
  };
}

function cleanSelectionFields(effect: ActiveEffectState): ActiveEffectState {
  return {
    ...effect,
    selectableCardIds: undefined,
    selectableCardVisibility: undefined,
    selectableCardMode: undefined,
    minSelectableCards: undefined,
    maxSelectableCards: undefined,
    selectableOptions: undefined,
    selectionLabel: undefined,
    confirmSelectionLabel: undefined,
    canSkipSelection: false,
    skipSelectionLabel: undefined,
  };
}

function selectNextMember(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue
): GameState {
  const remaining = getRemaining(effect);
  const ids = getChangeablePrintempsMemberIds(game, effect.controllerId);
  if (remaining <= 0 || ids.length === 0) {
    return finish(
      game,
      effect,
      effect.metadata?.orderedResolution === true,
      continuation,
      remaining <= 0 ? 'FINISH_MEMBER_STATE_CHANGES' : 'NO_CHANGEABLE_PRINTEMPS_TARGET'
    );
  }
  return {
    ...game,
    activeEffect: {
      ...cleanSelectionFields(effect),
      stepId: SELECT_MEMBER,
      stepText: `请选择1名『Printemps』成员改变状态：活跃成员变为待机状态，待机成员变为活跃状态。还需处理${remaining}次，可以再次选择同一成员。`,
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要改变状态的『Printemps』成员',
      confirmSelectionLabel: '改变状态',
      metadata: {
        ...effect.metadata,
        targetLifecycleIds: Object.fromEntries(
          ids.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
  };
}

function getChangeablePrintempsMemberIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  const activationProhibited = isMemberEffectActivationProhibited(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, printempsMember, (_game, _playerId, id) => {
    const orientation = player?.memberSlots.cardStates.get(id)?.orientation;
    return (
      orientation === OrientationState.ACTIVE ||
      (orientation === OrientationState.WAITING && !activationProhibited)
    );
  });
}

function getRemaining(effect: ActiveEffectState): number {
  return typeof effect.metadata?.remainingChanges === 'number'
    ? effect.metadata.remainingChanges
    : 0;
}

function finish(
  game: GameState,
  context: SourceContext,
  ordered: boolean,
  continuation: Continue,
  step: string
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== context.id),
        activeEffect: game.activeEffect?.id === context.id ? null : game.activeEffect,
      },
      'RESOLVE_ABILITY',
      context.controllerId,
      {
        pendingAbilityId: context.id,
        abilityId: ABILITY_ID,
        sourceCardId: context.sourceCardId,
        step,
      }
    ),
    ordered
  );
}
