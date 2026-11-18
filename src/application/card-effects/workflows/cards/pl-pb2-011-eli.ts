import { appendTriggeredAbility, recordTriggeredAbility } from '../../runtime/enqueue-pending-ability.js';
import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getCardsBelowSourceMember } from '../../../../domain/rules/member-below-queries.js';
import { isMemberStateChangeByOwnCardEffect } from '../../../../domain/rules/member-state-change-queries.js';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
  CardType,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { PL_PB2_011_AUTO_OWN_EFFECT_WAIT_OPPONENT_STACK_BIBI_MEMBER_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { hasAbilityInstance } from '../../runtime/ability-instance.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerMemberStateChangedObserver } from '../../runtime/member-state-changed-observers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_PB2_011_ELI_SELECT_WAITING_BIBI_MEMBER';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb2011EliWorkflowHandlers(): void {
  registerMemberStateChangedObserver((game, { events }) => {
    let state = game;
    for (const event of events) {
      if (
        event.previousOrientation !== OrientationState.ACTIVE ||
        event.nextOrientation !== OrientationState.WAITING
      )
        continue;
      for (const player of state.players) {
        if (
          event.controllerId === player.id ||
          !isMemberStateChangeByOwnCardEffect(state, event, player.id)
        )
          continue;
        for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
          const sourceCardId = player.memberSlots.slots[slot];
          const source = sourceCardId ? getCardById(state, sourceCardId) : null;
          if (
            !sourceCardId ||
            !source ||
            !isMemberCardData(source.data) ||
            !cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-011')
          )
            continue;
          const id = `${ABILITY_ID}:${sourceCardId}:${event.eventId}`;
          if (hasAbilityInstance(state, id)) continue;
          const ability: PendingAbilityState = {
            id,
            abilityId: ABILITY_ID,
            sourceCardId,
            controllerId: player.id,
            sourceLifecycleId: getAbilitySourceLifecycleId(state, ABILITY_ID, sourceCardId, [
              event.eventId,
            ]),
            sourceSlot: slot,
            mandatory: true,
            timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
            eventIds: [event.eventId],
          };
          state = recordTriggeredAbility(
            { ...state, pendingAbilities: appendTriggeredAbility(state, ability) },
            'TRIGGER_ABILITY',
            player.id,
            {
              pendingAbilityId: id,
              abilityId: ABILITY_ID,
              sourceCardId,
              sourceSlot: slot,
              sourceLifecycleId: ability.sourceLifecycleId,
              timingId: ability.timingId,
              eventIds: ability.eventIds,
            }
          );
        }
      }
    }
    return state;
  });
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const candidates = canStack(game, ability) ? getCandidates(game, ability.controllerId) : [];
    if (candidates.length === 0)
      return finish(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        controllerId: ability.controllerId,
        awaitingPlayerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: STEP_ID,
        stepText: '请选择休息室中1张『BiBi』成员卡放置于此成员下方。',
        selectableCardIds: candidates,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        canSkipSelection: false,
        selectionLabel: '选择要放置于此成员下方的成员卡',
        confirmSelectionLabel: '放置于此成员下方',
        metadata: { orderedResolution: options.orderedResolution === true },
      },
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'SELECT_WAITING_BIBI_MEMBER',
        selectableCardIds: candidates,
      },
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (game, input, context) => {
    const effect = getCardActiveEffect(game);
    if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
    const ordered = effect.metadata?.orderedResolution === true;
    if (!canStack(game, effect))
      return finish(game, effect, ordered, context.continuePendingCardEffects);
    const candidates = getCandidates(game, effect.controllerId);
    if (candidates.length === 0)
      return finish(game, effect, ordered, context.continuePendingCardEffects);
    const cardId = input.selectedCardId;
    if (!cardId || !effect.selectableCardIds?.includes(cardId)) return game;
    if (!candidates.includes(cardId))
      return { ...game, activeEffect: { ...effect, selectableCardIds: candidates } };
    const result = stackMemberCardBelowStageMember(game, {
      playerId: effect.controllerId,
      sourceZone: ZoneType.WAITING_ROOM,
      movedCardId: cardId,
      hostCardId: effect.sourceCardId,
      targetSlot: getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId)!,
    });
    return result
      ? finish(result.gameState, effect, ordered, context.continuePendingCardEffects, cardId)
      : game;
  });
}

function canStack(game: GameState, context: PendingAbilityState | ActiveEffectState): boolean {
  const source = getCardById(game, context.sourceCardId);
  return (
    source !== null &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-011') &&
    getSourceMemberSlot(game, context.controllerId, context.sourceCardId) !== null &&
    (context.sourceLifecycleId === undefined ||
      context.sourceLifecycleId ===
        getAbilitySourceLifecycleId(game, ABILITY_ID, context.sourceCardId)) &&
    getCardsBelowSourceMember(game, context.controllerId, context.sourceCardId).length <= 2
  );
}

function getCandidates(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'))
  );
}

function finish(
  game: GameState,
  context: PendingAbilityState | ActiveEffectState,
  ordered: boolean,
  continuation: ContinuePendingCardEffects,
  stackedCardId?: string
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
        step: stackedCardId ? 'STACK_WAITING_BIBI_MEMBER_BELOW_SOURCE' : 'NO_VALID_BIBI_STACK',
        stackedCardId: stackedCardId ?? null,
      }
    ),
    ordered
  );
}
