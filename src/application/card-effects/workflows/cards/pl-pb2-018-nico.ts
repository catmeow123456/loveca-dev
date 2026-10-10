import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { isDirectOrGrantedTriggeredAbilitySource } from '../../runtime/granted-member-below-abilities.js';
import { hasAtLeastDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation, setMembersOrientation } from '../../../effects/member-state.js';
import {
  getStageMemberCardIdsMatching,
  getStageMemberCardIdsByOrientation,
} from '../../../effects/stage-targets.js';
import {
  PL_PB2_018_ON_ENTER_ACTIVATE_OPPONENT_MEMBERS_DRAW_ABILITY_ID as ACTIVATE_DRAW,
  PL_PB2_018_ON_ENTER_DISCARD_THREE_DIFFERENT_BIBI_WAIT_OPPONENT_ABILITY_ID as ENTER_DISCARD,
  PL_PB2_018_LIVE_START_DISCARD_THREE_DIFFERENT_BIBI_WAIT_OPPONENT_ABILITY_ID as START_DISCARD,
} from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_ACTIVATE = 'PL_PB2_018_SELECT_OPPONENT_WAITING_MEMBERS';
const SELECT_DISCARD = 'PL_PB2_018_SELECT_THREE_DIFFERENT_BIBI_HAND';
const SELECT_WAIT = 'PL_PB2_018_SELECT_OPPONENT_MEMBER_TO_WAIT';
const bibiMember = and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'));
const member = typeIs(CardType.MEMBER);
type SourceContext = PendingAbilityState | ActiveEffectState;
type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlPb2018NicoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ACTIVATE_DRAW, (game, ability, options, context) => {
    const ordered = options.orderedResolution === true;
    if (!sourceIsEligible(game, ability))
      return finish(game, ability, ordered, context.continuePendingCardEffects, 'SOURCE_INVALID');
    const candidates = getWaitingOpponentMembers(game, ability.controllerId);
    if (candidates.length === 0)
      return finish(
        game,
        ability,
        ordered,
        context.continuePendingCardEffects,
        'NO_WAITING_OPPONENT_MEMBERS'
      );
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: activationSelection(game, ability, candidates, ordered),
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'SELECT_OPPONENT_MEMBERS_TO_ACTIVATE',
        selectableCardIds: candidates,
      },
    });
  });
  registerActiveEffectStepHandler(ACTIVATE_DRAW, SELECT_ACTIVATE, (game, input, context) => {
    const effect = game.activeEffect!;
    const ordered = effect.metadata?.orderedResolution === true;
    if (!sourceIsEligible(game, effect))
      return finish(game, effect, ordered, context.continuePendingCardEffects, 'SOURCE_INVALID');
    const selected = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
    if (selected.length === 0)
      return finish(
        game,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'DECLINED_ACTIVATE_DRAW'
      );
    const candidates = getWaitingOpponentMembers(game, effect.controllerId);
    const opponent = getOpponent(game, effect.controllerId);
    if (!opponent || candidates.length === 0)
      return finish(
        game,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'NO_WAITING_OPPONENT_MEMBERS'
      );
    if (
      selected.length > 3 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !effect.selectableCardIds?.includes(id) || !candidates.includes(id))
    ) {
      return sameIds(effect.selectableCardIds ?? [], candidates)
        ? game
        : {
            ...game,
            activeEffect: activationSelection(game, effect, candidates, ordered),
          };
    }
    const activation = setMembersOrientation(
      game,
      opponent.id,
      selected,
      OrientationState.ACTIVE,
      cause(effect)
    );
    if (!activation) return game;
    const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      activation,
      deps.enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (state, result, events) =>
          addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'ACTIVATE_OPPONENT_MEMBERS',
            selectedCardIds: selected,
            activatedMemberCardIds: result.updatedMemberCardIds,
            memberStateChangedEventIds: events.map((event) => event.eventId),
          }),
      }
    ).gameState;
    const draw =
      activation.updatedMemberCardIds.length > 0
        ? drawCardsForPlayer(
            stateWithTriggers,
            effect.controllerId,
            activation.updatedMemberCardIds.length
          )
        : { gameState: stateWithTriggers, drawnCardIds: [] };
    if (!draw) return game;
    return finish(
      draw.gameState,
      effect,
      ordered,
      context.continuePendingCardEffects,
      'FINISH_ACTIVATE_DRAW',
      {
        activatedMemberCardIds: activation.updatedMemberCardIds,
        drawnCardIds: draw.drawnCardIds,
      }
    );
  });

  for (const abilityId of [ENTER_DISCARD, START_DISCARD]) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) => {
      const ordered = options.orderedResolution === true;
      if (!sourceIsEligible(game, ability))
        return finish(game, ability, ordered, context.continuePendingCardEffects, 'SOURCE_INVALID');
      const candidates = getDiscardCandidates(game, ability.controllerId);
      if (!hasThreeDifferentNames(game, candidates)) {
        const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
          game,
          ability,
          options,
          {
            effectText: `${getAbilityEffectText(abilityId)}\n（当前无法支付所需费用，不执行后续效果。）`,
          }
        );
        return (
          confirmation ??
          finish(
            game,
            ability,
            ordered,
            context.continuePendingCardEffects,
            'NO_LEGAL_DISCARD_COST'
          )
        );
      }
      return startPendingActiveEffect(game, {
        ability,
        playerId: ability.controllerId,
        activeEffect: discardSelection(game, ability, candidates, ordered),
        actionPayload: {
          sourceCardId: ability.sourceCardId,
          step: 'SELECT_THREE_DIFFERENT_BIBI_DISCARD',
          selectableCardIds: candidates,
        },
      });
    });
    registerActiveEffectStepHandler(abilityId, SELECT_DISCARD, (game, input, context) => {
      const effect = game.activeEffect!;
      const ordered = effect.metadata?.orderedResolution === true;
      if (!sourceIsEligible(game, effect))
        return finish(game, effect, ordered, context.continuePendingCardEffects, 'SOURCE_INVALID');
      const selected =
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
      if (selected.length === 0)
        return finish(
          game,
          effect,
          ordered,
          context.continuePendingCardEffects,
          'DECLINED_DISCARD_COST'
        );
      const candidates = getDiscardCandidates(game, effect.controllerId);
      if (!hasThreeDifferentNames(game, candidates))
        return finish(
          game,
          effect,
          ordered,
          context.continuePendingCardEffects,
          'NO_LEGAL_DISCARD_COST'
        );
      if (
        selected.length !== 3 ||
        new Set(selected).size !== 3 ||
        selected.some(
          (id) => !candidates.includes(id) || !effect.selectableCardIds?.includes(id)
        ) ||
        !hasThreeDifferentNames(game, selected)
      ) {
        return sameIds(effect.selectableCardIds ?? [], candidates)
          ? game
          : {
              ...game,
              activeEffect: discardSelection(game, effect, candidates, ordered),
            };
      }
      const payment = discardHandCardsToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        selected,
        { count: 3, candidateCardIds: candidates },
        deps.enqueueTriggeredCardEffects
      );
      if (!payment) return game;
      const paid = recordPayCostAction(payment.gameState, effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceLifecycleId: effect.sourceLifecycleId,
        pendingAbilityId: effect.id,
        discardedHandCardIds: payment.discardedCardIds,
        enterWaitingRoomEventId: payment.enterWaitingRoomEvent?.eventId,
      });
      return startWaitTarget(paid, effect, context.continuePendingCardEffects);
    });
    registerActiveEffectStepHandler(abilityId, SELECT_WAIT, (game, input, context) => {
      const effect = game.activeEffect!;
      const ordered = effect.metadata?.orderedResolution === true;
      if (!ownStageOnlyBibi(game, effect.controllerId))
        return finish(
          game,
          effect,
          ordered,
          context.continuePendingCardEffects,
          'STAGE_NOT_ONLY_BIBI_AFTER_COST'
        );
      const opponent = getOpponent(game, effect.controllerId);
      const candidates = opponent ? getStageMemberCardIdsMatching(game, opponent.id, member) : [];
      if (!opponent || candidates.length === 0)
        return finish(
          game,
          effect,
          ordered,
          context.continuePendingCardEffects,
          'NO_OPPONENT_TARGET_AFTER_COST'
        );
      const selected = input.selectedCardId;
      if (!selected || !effect.selectableCardIds?.includes(selected)) return game;
      if (!candidates.includes(selected))
        return startWaitTarget(game, effect, context.continuePendingCardEffects);
      const result = setMemberOrientation(
        game,
        opponent.id,
        selected,
        OrientationState.WAITING,
        cause(effect)
      );
      if (!result) return game;
      const state = enqueueMemberStateChangedTriggersFromOrientationResult(
        game,
        result,
        deps.enqueueTriggeredCardEffects,
        {
          prepareGameStateBeforeEnqueue: (current, change, events) =>
            addAction(current, 'RESOLVE_ABILITY', effect.controllerId, {
              pendingAbilityId: effect.id,
              abilityId: effect.abilityId,
              sourceCardId: effect.sourceCardId,
              step: 'WAIT_OPPONENT_MEMBER_AFTER_DISCARD',
              targetMemberCardId: selected,
              changed: change.changed,
              memberStateChangedEventIds: events.map((event) => event.eventId),
            }),
        }
      ).gameState;
      return finish(
        state,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'FINISH_DISCARD_WAIT'
      );
    });
  }
}

function getWaitingOpponentMembers(game: GameState, playerId: string): readonly string[] {
  const opponent = getOpponent(game, playerId);
  return opponent
    ? getStageMemberCardIdsByOrientation(game, opponent.id, OrientationState.WAITING)
    : [];
}
function getDiscardCandidates(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.hand.cardIds.filter((id) => {
      const card = getCardById(game, id);
      return card !== null && card.ownerId === playerId && bibiMember(card);
    }) ?? []
  );
}
function hasThreeDifferentNames(game: GameState, ids: readonly string[]): boolean {
  return hasAtLeastDifferentNamedCards(ids, 3, (id) => getCardById(game, id)?.data);
}
function ownStageOnlyBibi(game: GameState, playerId: string): boolean {
  const ids = getStageMemberCardIdsMatching(game, playerId, member);
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const card = getCardById(game, id);
      return card !== null && bibiMember(card);
    })
  );
}
function sourceIsEligible(game: GameState, context: SourceContext): boolean {
  const source = getCardById(game, context.sourceCardId);
  // These triggered effects do not act on the source itself. Leaving/re-entering
  // the stage does not cancel the old ability or transfer its original lifecycle.
  return (
    source !== null &&
    source.ownerId === context.controllerId &&
    isMemberCardData(source.data) &&
    isDirectOrGrantedTriggeredAbilitySource(game, context, ['PL!-pb2-018'])
  );
}
function sourceLifecycle(game: GameState, context: SourceContext): string {
  return (
    context.sourceLifecycleId ??
    getAbilitySourceLifecycleId(
      game,
      context.abilityId,
      context.sourceCardId,
      'eventIds' in context ? context.eventIds : undefined
    )
  );
}
function activationSelection(
  game: GameState,
  context: SourceContext,
  candidates: readonly string[],
  ordered: boolean
): ActiveEffectState {
  return {
    id: context.id,
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
    sourceLifecycleId: sourceLifecycle(game, context),
    controllerId: context.controllerId,
    awaitingPlayerId: context.controllerId,
    effectText: getAbilityEffectText(context.abilityId),
    stepId: SELECT_ACTIVATE,
    stepText:
      '可以选择对方舞台至多3名待机状态成员变为活跃状态，每有1名因此变为活跃状态的成员，抽1张卡。',
    selectableCardIds: candidates,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: 0,
    maxSelectableCards: Math.min(3, candidates.length),
    selectionLabel: '选择要变为活跃状态的对方成员',
    confirmSelectionLabel: '变为活跃状态',
    canSkipSelection: true,
    skipSelectionLabel: '不发动',
    metadata: { orderedResolution: ordered },
  };
}
function discardSelection(
  game: GameState,
  context: SourceContext,
  candidates: readonly string[],
  ordered: boolean
): ActiveEffectState {
  return {
    ...createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability: context,
      playerId: context.controllerId,
      effectText: getAbilityEffectText(context.abilityId),
      stepId: SELECT_DISCARD,
      selectableCardIds: candidates,
      orderedResolution: ordered,
      discardCount: 3,
      stepText: '可以将手牌中3张名称各不相同的『BiBi』成员卡放置入休息室作为费用。',
      selectionLabel: '选择名称各不相同的3张『BiBi』成员卡',
    }),
    sourceLifecycleId: sourceLifecycle(game, context),
  };
}
function startWaitTarget(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue
): GameState {
  const ordered = effect.metadata?.orderedResolution === true;
  if (!ownStageOnlyBibi(game, effect.controllerId))
    return finish(game, effect, ordered, continuation, 'STAGE_NOT_ONLY_BIBI_AFTER_COST');
  const opponent = getOpponent(game, effect.controllerId);
  const candidates = opponent ? getStageMemberCardIdsMatching(game, opponent.id, member) : [];
  if (candidates.length === 0)
    return finish(game, effect, ordered, continuation, 'NO_OPPONENT_TARGET_AFTER_COST');
  return {
    ...game,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceLifecycleId: effect.sourceLifecycleId,
      controllerId: effect.controllerId,
      awaitingPlayerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: SELECT_WAIT,
      stepText: '请选择对方舞台的1名成员变为待机状态。',
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
      selectionLabel: '选择要变为待机状态的对方成员',
      confirmSelectionLabel: '变为待机状态',
      metadata: { orderedResolution: ordered },
    },
  };
}
function cause(effect: ActiveEffectState) {
  return {
    kind: 'CARD_EFFECT' as const,
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    pendingAbilityId: effect.id,
  };
}
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
function finish(
  game: GameState,
  context: SourceContext,
  ordered: boolean,
  continuation: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
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
        abilityId: context.abilityId,
        sourceCardId: context.sourceCardId,
        sourceLifecycleId: context.sourceLifecycleId,
        step,
        ...payload,
      }
    ),
    ordered
  );
}
