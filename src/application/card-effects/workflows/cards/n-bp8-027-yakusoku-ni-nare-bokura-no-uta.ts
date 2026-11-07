import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import { N_BP8_027_LIVE_SUCCESS_CHOOSE_WAITING_ROOM_TOP_OR_ENERGY_UNDER_NIJIGASAKI_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';

const CHOOSE = 'N_BP8_027_CHOOSE_LIVE_SUCCESS_EFFECT';
const WAITING = 'N_BP8_027_SELECT_WAITING_ROOM_NIJIGASAKI_CARD';
const MEMBER = 'N_BP8_027_SELECT_STAGE_NIJIGASAKI_MEMBER';
const TOP_OPTION = 'waiting-room-to-deck-top';
const ENERGY_OPTION = 'energy-under-nijigasaki-member';
const isNijigasaki = groupAliasIs('虹ヶ咲');
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp8027YakusokuNiNareBokuraNoUtaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY, (game, ability, options) =>
    start(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    ABILITY,
    CHOOSE,
    (game, input, context) =>
      chooseBranch(
        game,
        input.selectedEffectOptionIds ?? (input.selectedOptionId ? [input.selectedOptionId] : []),
        context.continuePendingCardEffects
      ),
    queryOptionSelection
  );
  for (const step of [WAITING, MEMBER]) {
    registerActiveEffectStepHandler(
      ABILITY,
      step,
      (game, input, context) =>
        finishTarget(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
      queryCardSelection
    );
  }
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean): GameState {
  if (!getPlayerById(game, ability.controllerId)) return game;
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE,
      stepText: '请选择1项LIVE成功效果。',
      awaitingPlayerId: ability.controllerId,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: TOP_OPTION, text: '将休息室1张『虹咲』的卡片放置于卡组顶', selectable: true },
          {
            id: ENERGY_OPTION,
            text: '将能量卡组顶的1张能量卡放置于『虹咲』成员下方',
            selectable: true,
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution: ordered },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'CHOOSE_LIVE_SUCCESS_EFFECT' },
  });
}

function getWaitingCandidates(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.waitingRoom.cardIds.filter((id) => {
      const card = getCardById(game, id);
      return card !== null && card.ownerId === playerId && isNijigasaki(card);
    }) ?? []
  );
}

function getMemberCandidates(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, and(typeIs(CardType.MEMBER), isNijigasaki));
}

function chooseBranch(game: GameState, ids: readonly string[], next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY ||
    effect.stepId !== CHOOSE ||
    ids.length !== 1 ||
    (ids[0] !== TOP_OPTION && ids[0] !== ENERGY_OPTION)
  )
    return game;
  const waiting = ids[0] === TOP_OPTION;
  const candidates = waiting
    ? getWaitingCandidates(game, effect.controllerId)
    : getMemberCandidates(game, effect.controllerId);
  if (candidates.length === 0)
    return finish(game, effect, next, 'NO_LEGAL_TARGET', { selectedOptionId: ids[0] });
  // Build the next effect explicitly: branch fields and the public choice window
  // must not survive into the card/target selection contract.
  return {
    ...game,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: waiting ? WAITING : MEMBER,
      stepText: waiting
        ? '请选择自己休息室1张『虹咲』的卡片放置于卡组顶。'
        : '请选择自己舞台1名『虹咲』成员，将能量卡组顶的1张能量卡放置于其下方。',
      awaitingPlayerId: effect.controllerId,
      selectableCardIds: candidates,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: waiting
        ? '选择要放置于卡组顶的『虹咲』卡片'
        : '选择要放置能量卡的『虹咲』成员',
      confirmSelectionLabel: waiting ? '放置于卡组顶' : '放置于成员下方',
      canSkipSelection: false,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        selectedOptionId: ids[0],
        ...(waiting
          ? {
              publicCardSelectionConfirmation: {
                source: 'WAITING_ROOM',
                destination: 'MAIN_DECK_TOP',
              },
              waitingSelectionSequence: game.eventLog.at(-1)?.sequence ?? 0,
            }
          : {
              targetLifecycles: Object.fromEntries(
                candidates.map((id) => [id, getStageMemberLifecycleId(game, id)])
              ),
            }),
      },
    },
  };
}

function finishTarget(game: GameState, id: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY ||
    ![WAITING, MEMBER].includes(effect.stepId) ||
    !id ||
    !effect.selectableCardIds?.includes(id)
  )
    return game;
  if (effect.stepId === WAITING) {
    const reentered = hasWaitingRoomSelectionReenteredAfter(
      game,
      [id],
      effect.metadata?.waitingSelectionSequence
    );
    if (!getWaitingCandidates(game, effect.controllerId).includes(id) || reentered) {
      return wasRestoredAfterPublicCardSelectionConfirmation(effect)
        ? finish(game, effect, next, 'STALE_TARGET_NO_OP', { targetCardId: id })
        : game;
    }
    const moved = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
      { ...game, activeEffect: null },
      effect.controllerId,
      [id],
      {
        candidateCardIds: effect.selectableCardIds,
        minCount: 1,
        maxCount: 1,
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
      ? finish(moved.gameState, effect, next, 'WAITING_ROOM_CARD_TO_DECK_TOP', {
          movedCardIds: moved.movedCardIds,
        })
      : game;
  }
  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  if (
    !getMemberCandidates(game, effect.controllerId).includes(id) ||
    lifecycles?.[id] !== getStageMemberLifecycleId(game, id)
  ) {
    return finish(game, effect, next, 'STALE_TARGET_NO_OP', { targetCardId: id });
  }
  const placed = placeEnergyFromEnergyDeckBelowStageMember(game, effect.controllerId, id, 1);
  return finish(placed?.gameState ?? game, effect, next, 'PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER', {
    targetCardId: id,
    targetSlot: placed?.targetSlot ?? null,
    placedEnergyCardIds: placed?.placedEnergyCardIds ?? [],
  });
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      selectedOptionId: effect.metadata?.selectedOptionId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
