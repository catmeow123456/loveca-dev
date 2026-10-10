import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import {
  LL_BP8_001_ON_ENTER_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
  LL_BP8_001_LIVE_SUCCESS_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilitySourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { stackInspectedMemberBelowStageMember } from '../../runtime/inspection-member-below.js';
import { moveInspectedCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_IDS = [
  LL_BP8_001_ON_ENTER_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
  LL_BP8_001_LIVE_SUCCESS_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
];
const SELECT_STEP = 'LL_BP8_001_SELECT_INSPECTED_MEMBER';
const STACK_STEP = 'LL_BP8_001_STACK_REVEALED_MEMBER';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLlBp8001NicoAiSerasWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const abilityId of ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options) =>
      startInspection(game, ability, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_STEP,
      (game, input, context) =>
        selectMember(
          game,
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        ),
      queryCardSelection
    );
    registerActiveEffectStepHandler(abilityId, STACK_STEP, (game, _input, context) =>
      finishInspection(
        game,
        getSelectedCardId(game.activeEffect),
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const lifecycle = getPendingAbilitySourceLifecycleId(game, ability);
  const result = inspectTopCards(game, ability.controllerId, {
    count: 6,
    selectablePredicate: (card) =>
      card.ownerId === ability.controllerId && isMemberCardData(card.data),
  });
  if (!result) return game;
  const canStack = sourceHostIsCurrent(result.gameState, {
    ...ability,
    sourceLifecycleId: lifecycle,
  });
  const candidates = canStack ? result.selectableCardIds : [];
  return startPendingActiveEffect(result.gameState, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: lifecycle,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_STEP,
      stepText:
        candidates.length > 0
          ? '可以选择1张成员卡公开，放置于此成员下方；其余放置入休息室。'
          : result.inspectedCardIds.length > 0
            ? '没有可选择的目标。检视的卡片全部放置入休息室。'
            : '卡组中没有可检视的卡片。',
      awaitingPlayerId: ability.controllerId,
      inspectionCardIds: result.inspectedCardIds,
      selectableCardIds: candidates,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开并放置于此成员下方的成员卡',
      confirmSelectionLabel: '公开并放置于此成员下方',
      canSkipSelection: true,
      skipSelectionLabel: result.inspectedCardIds.length > 0 ? '全部放置入休息室' : '确认',
      metadata: { orderedResolution, inspectedCardIds: result.inspectedCardIds },
    },
    actionPayload: { step: 'LOOK_TOP_SIX', inspectedCardIds: result.inspectedCardIds },
  });
}

function selectMember(
  game: GameState,
  selectedIds: readonly string[],
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getEffect(game, SELECT_STEP);
  if (!effect) return game;
  if (selectedIds.length > 1 || new Set(selectedIds).size !== selectedIds.length) return game;
  const selected = selectedIds[0] ?? null;
  if (selected === null) return finishInspection(game, null, continuation, enqueue);
  const card = getCardById(game, selected);
  if (
    !card ||
    card.ownerId !== effect.controllerId ||
    !isMemberCardData(card.data) ||
    !effect.selectableCardIds?.includes(selected) ||
    !getInspectedIds(effect).includes(selected) ||
    !game.inspectionZone.cardIds.includes(selected)
  )
    return game;
  if (!sourceHostIsCurrent(game, effect))
    return finishInspection(game, null, continuation, enqueue);
  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds: [...new Set([...game.inspectionZone.revealedCardIds, selected])],
      },
      activeEffect: withPublicRevealDwell({
        ...effect,
        stepId: STACK_STEP,
        stepText: '已公开1张成员卡。展示结束后，将其放置于此成员下方，其余检视的卡片放置入休息室。',
        inspectionCardIds: undefined,
        revealedCardIds: [selected],
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: { ...effect.metadata, selectedCardId: selected },
      }),
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_SELECTED_MEMBER',
      selectedCardId: selected,
    }
  );
}

function finishInspection(
  game: GameState,
  selectedCardId: string | null,
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || !ABILITY_IDS.includes(effect.abilityId)) return game;
  let state = game;
  const stacked =
    selectedCardId && sourceHostIsCurrent(state, effect)
      ? stackInspectedMemberBelowStageMember(
          state,
          effect.controllerId,
          selectedCardId,
          effect.sourceCardId
        )
      : null;
  if (stacked) state = stacked.gameState;
  const remaining = getInspectedIds(effect).filter((id) =>
    state.inspectionZone.cardIds.includes(id)
  );
  const moved = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
    state,
    effect.controllerId,
    remaining,
    enqueue,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moved) return game;
  return continuation(
    addAction({ ...moved.gameState, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_LOOK_AND_STACK',
      stackedCardId: stacked?.movedCardId ?? null,
      waitingRoomCardIds: moved.waitingRoomCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function sourceHostIsCurrent(
  game: GameState,
  source: Pick<
    ActiveEffectState,
    'abilityId' | 'sourceCardId' | 'controllerId' | 'sourceLifecycleId'
  >
): boolean {
  const player = getPlayerById(game, source.controllerId);
  const card = getCardById(game, source.sourceCardId);
  return (
    player !== null &&
    card !== null &&
    card.ownerId === source.controllerId &&
    cardCodeMatchesBase(card.data.cardCode, 'LL-bp8-001') &&
    findMemberSlot(player, source.sourceCardId) !== null &&
    source.sourceLifecycleId ===
      getAbilitySourceLifecycleId(game, source.abilityId, source.sourceCardId)
  );
}

function getEffect(game: GameState, stepId: string): ActiveEffectState | null {
  return game.activeEffect &&
    ABILITY_IDS.includes(game.activeEffect.abilityId) &&
    game.activeEffect.stepId === stepId
    ? game.activeEffect
    : null;
}
function getInspectedIds(effect: ActiveEffectState): readonly string[] {
  const value = effect.metadata?.inspectedCardIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
function getSelectedCardId(effect: ActiveEffectState | null): string | null {
  return typeof effect?.metadata?.selectedCardId === 'string'
    ? effect.metadata.selectedCardId
    : null;
}
