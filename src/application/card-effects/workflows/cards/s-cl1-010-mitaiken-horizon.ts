import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  hasAllBladeHeart,
  hasDoubleGrayBladeHeart,
  hasScoreBladeHeart,
  typeIs,
} from '../../../effects/card-selectors.js';
import { S_CL1_010_LIVE_START_BOTTOM_GROUPED_AQOURS_LIVES_GAIN_CENTER_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForTargetMember } from '../../runtime/actions.js';
import {
  hasDistinctGroupedCardAssignment,
  readExclusiveCardSelectionInput,
  type DistinctCardSelectionGroup,
} from '../../runtime/grouped-selection.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_CL1_010_LIVE_START_BOTTOM_GROUPED_AQOURS_LIVES_GAIN_CENTER_BLADE_ABILITY_ID;
const STEP_ID = 'S_CL1_010_SELECT_GROUPED_AQOURS_LIVES_TO_DECK_BOTTOM';
const aqoursLive = and(typeIs(CardType.LIVE), groupAliasIs('Aqours'));
const groupSelectors = [hasScoreBladeHeart(), hasAllBladeHeart(), hasDoubleGrayBladeHeart()];
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSCl1010MitaikenHorizonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (game, input, context) => {
    const selected = readExclusiveCardSelectionInput(input);
    return selected === null ? game : finish(game, selected, context.continuePendingCardEffects);
  });
}

function getGroups(game: GameState, playerId: string): readonly DistinctCardSelectionGroup[] {
  const player = getPlayerById(game, playerId);
  return groupSelectors.map((selector) => ({
    candidateCardIds: (player?.waitingRoom.cardIds ?? []).filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === playerId && aqoursLive(card) && selector(card);
    }),
    minCount: 0,
    maxCount: 1,
  }));
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const ordered = options.orderedResolution === true;
  const groups = getGroups(game, ability.controllerId);
  const candidates = [...new Set(groups.flatMap((group) => group.candidateCardIds))];
  if (candidates.length === 0) {
    return (
      (ordered
        ? null
        : maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
            effectText: `${getAbilityEffectText(ABILITY_ID)}（当前自己休息室中符合这三类条件的『Aqours』LIVE卡为0张，不放置卡片且不增加[BLADE]。）`,
            stepText: '没有可放置于卡组底的卡片，确认后结束此效果。',
          })) ?? complete(game, ability, ordered, next, 'NO_GROUPED_AQOURS_LIVE')
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: STEP_ID,
      stepText:
        '可以从自己休息室中，按放置顺序选择持有[スコア]、[ALLハート]、[ダブル無色ブレード]的『Aqours』LIVE卡各至多1张。同一张卡只能占用1个名额。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(3, candidates.length),
      selectionLabel: '按放置顺序选择各类LIVE卡',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        orderedResolution: ordered,
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: ability.controllerId,
          distinctGroupAssignment: true,
          groups,
        },
      },
    },
    actionPayload: { step: 'START_SELECT_GROUPED_AQOURS_LIVES', candidateCardIds: candidates },
  });
}

function finish(game: GameState, selected: readonly string[], next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
  const ordered = effect.metadata?.orderedResolution === true;
  if (
    new Set(selected).size !== selected.length ||
    selected.length > (effect.maxSelectableCards ?? 3) ||
    selected.some((id) => !effect.selectableCardIds?.includes(id))
  )
    return game;
  if (selected.length === 0)
    return complete(game, effect, ordered, next, 'DECLINE_BOTTOM_GROUPED_AQOURS_LIVES');
  const groups = getGroups(game, effect.controllerId);
  if (!hasDistinctGroupedCardAssignment(selected, groups)) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? complete(game, effect, ordered, next, 'STALE_GROUPED_AQOURS_LIVE_SELECTION')
      : game;
  }
  const moved = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    effect.controllerId,
    selected,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: 0,
      maxCount: 3,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moved)
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? complete(game, effect, ordered, next, 'STALE_GROUPED_AQOURS_LIVE_SELECTION')
      : game;
  let state = moved.gameState;
  const player = getPlayerById(state, effect.controllerId);
  const centerId = player?.memberSlots.slots[SlotPosition.CENTER];
  const center = centerId ? getCardById(state, centerId) : null;
  const targetId =
    center &&
    center.ownerId === effect.controllerId &&
    isMemberCardData(center.data) &&
    groupAliasIs('Aqours')(center)
      ? centerId!
      : null;
  if (targetId) {
    state =
      addBladeLiveModifierForTargetMember(state, {
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        targetMemberCardId: targetId,
        abilityId: ABILITY_ID,
        amount: moved.movedCardIds.length,
      })?.gameState ?? state;
  }
  return complete(state, effect, ordered, next, 'BOTTOM_GROUPED_AQOURS_LIVES_GAIN_CENTER_BLADE', {
    selectedCardIds: selected,
    movedCardIds: moved.movedCardIds,
    targetMemberCardId: targetId,
    bladeBonus: targetId ? moved.movedCardIds.length : 0,
  });
}

function complete(
  game: GameState,
  source: PendingAbilityState | ActiveEffectState,
  ordered: boolean,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return next(
    addAction(
      {
        ...game,
        activeEffect: game.activeEffect?.id === source.id ? null : game.activeEffect,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== source.id),
      },
      'RESOLVE_ABILITY',
      source.controllerId,
      {
        pendingAbilityId: source.id,
        abilityId: source.abilityId,
        sourceCardId: source.sourceCardId,
        step,
        movedCardIds: [],
        ...payload,
      }
    ),
    ordered
  );
}
