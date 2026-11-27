import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';
import {
  S_PB2_001_AUTO_STACK_AQOURS_LIVE_ABILITY_ID,
  S_PB2_001_LIVE_START_RETURN_AQOURS_LIVES_ABILITY_ID,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerEnterWaitingRoomPerCardTrigger } from '../../runtime/enter-waiting-room-triggers.js';
import {
  moveLivesBelowStageMemberToDeckTop,
  stackWaitingRoomLiveBelowStageMember,
} from '../../runtime/member-below-movement.js';
import { registerPendingAbilityPreflightHandler } from '../../runtime/pending-ability-preflight.js';
import { registerPendingOrderOptionHintHandler } from '../../runtime/pending-order-option-hints.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const AUTO = S_PB2_001_AUTO_STACK_AQOURS_LIVE_ABILITY_ID;
const LIVE_START = S_PB2_001_LIVE_START_RETURN_AQOURS_LIVES_ABILITY_ID;
const STACK_STEP = 'S_PB2_001_STACK_AQOURS_LIVE';
const STACK_OPTION = 'stack';
const DECK_TOP_STEP = 'S_PB2_001_ORDER_AQOURS_LIVES';
const isAqours = groupAliasIs('Aqours');

type AbilitySource = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId' | 'sourceLifecycleId'
>;
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb2001ChikaWorkflowHandlers(): void {
  registerEnterWaitingRoomPerCardTrigger(
    AUTO,
    (game, event, cardId) =>
      event.ownerId === event.controllerId && isOwnAqoursLive(game, event.controllerId, cardId)
  );
  registerPendingAbilityPreflightHandler(AUTO, (game, ability) =>
    getPendingStackTarget(game, ability) ? null : { step: 'STACK_TARGET_UNAVAILABLE' }
  );
  registerPendingOrderOptionHintHandler(AUTO, (game, ability) => {
    const target = getPendingStackTarget(game, ability);
    return target ? `本次放置对象：${getCardById(game, target.cardId)?.data.name}` : null;
  });
  registerPendingAbilityStarterHandler(AUTO, (game, ability, options, context) =>
    startStack(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    AUTO,
    STACK_STEP,
    (game, input, context) =>
      finishStack(
        game,
        input.selectedOptionId === STACK_OPTION,
        context.continuePendingCardEffects
      ),
    queryOptionSelection
  );
  registerPendingAbilityStarterHandler(LIVE_START, (game, ability, options, context) =>
    startReturnLives(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    LIVE_START,
    DECK_TOP_STEP,
    (game, input, context) =>
      finishReturnLives(game, input.selectedCardIds ?? [], context.continuePendingCardEffects),
    queryCardSelection
  );
}

function isOwnAqoursLive(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card?.ownerId === playerId && isLiveCardData(card.data) && isAqours(card);
}

function getStackTarget(
  game: GameState,
  source: AbilitySource,
  eventId: unknown,
  cardId: unknown
): { readonly eventId: string; readonly cardId: string } | null {
  if (
    typeof eventId !== 'string' ||
    typeof cardId !== 'string' ||
    !isCurrentStageMemberAbilitySource(game, source) ||
    !isOwnAqoursLive(game, source.controllerId, cardId) ||
    !getPlayerById(game, source.controllerId)?.waitingRoom.cardIds.includes(cardId)
  ) {
    return null;
  }
  const record = game.eventLog.find(({ event }) => event.eventId === eventId);
  const event = record?.event;
  const movedCardIds = event && 'cardInstanceIds' in event ? event.cardInstanceIds : undefined;
  if (
    !record ||
    event?.eventType !== TriggerCondition.ON_ENTER_WAITING_ROOM ||
    event.controllerId !== source.controllerId ||
    event.ownerId !== source.controllerId ||
    event.fromZone !== ZoneType.LIVE_ZONE ||
    !(movedCardIds ?? [event.cardInstanceId]).includes(cardId) ||
    hasWaitingRoomSelectionReenteredAfter(game, [cardId], record.sequence)
  ) {
    return null;
  }
  return { eventId, cardId };
}

function getPendingStackTarget(game: GameState, ability: PendingAbilityState) {
  const movedCardIds = ability.metadata?.movedCardIds;
  return getStackTarget(
    game,
    { ...ability, sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability) },
    ability.eventIds?.[0],
    Array.isArray(movedCardIds) ? movedCardIds[0] : undefined
  );
}

function startStack(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuation: Continue
): GameState {
  const target = getPendingStackTarget(game, ability);
  if (!target) {
    return finish(game, ability, orderedResolution, continuation, 'STACK_TARGET_UNAVAILABLE');
  }
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const name = getCardById(game, target.cardId)?.data.name;
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId,
      controllerId: ability.controllerId,
      awaitingPlayerId: ability.controllerId,
      effectText: getAbilityEffectText(AUTO),
      stepId: STACK_STEP,
      stepText: `可以将「${name}」放置于此成员下方。`,
      selectableOptions: [{ id: STACK_OPTION, label: '放置于此成员下方' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { ...target, orderedResolution },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_STACK_AQOURS_LIVE' },
  });
}

function finishStack(game: GameState, stack: boolean, continuation: Continue): GameState {
  const effect = getCardActiveEffect(game);
  if (effect?.abilityId !== AUTO || effect.stepId !== STACK_STEP) return game;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!stack) return finish(game, effect, orderedResolution, continuation, 'DECLINE_STACK');
  const target = getStackTarget(game, effect, effect.metadata?.eventId, effect.metadata?.cardId);
  const moved = target
    ? stackWaitingRoomLiveBelowStageMember(
        game,
        effect.controllerId,
        effect.sourceCardId,
        target.cardId
      )
    : null;
  return finish(
    moved ?? game,
    effect,
    orderedResolution,
    continuation,
    moved ? 'STACK_AQOURS_LIVE' : 'STACK_TARGET_UNAVAILABLE',
    moved && target ? { stackedCardId: target.cardId } : undefined
  );
}

function getLivesBelowSource(game: GameState, source: AbilitySource): readonly string[] {
  if (!isCurrentStageMemberAbilitySource(game, source)) return [];
  const player = getPlayerById(game, source.controllerId);
  if (!player) return [];
  const slot = findMemberSlot(player, source.sourceCardId);
  return slot === null
    ? []
    : (player.memberSlots.memberBelow?.[slot] ?? []).filter((id) =>
        isOwnAqoursLive(game, source.controllerId, id)
      );
}

function startReturnLives(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuation: Continue
): GameState {
  const source = {
    ...ability,
    sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
  };
  const cardIds = getLivesBelowSource(game, source);
  const orderedResolution = options.orderedResolution === true;
  if (cardIds.length <= 1) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, source, options, {
      effectText: `${getAbilityEffectText(LIVE_START)}（将放置${cardIds.length}张卡，获得${cardIds.length}个[ブレード]。）`,
    });
    return (
      confirmation ??
      returnLivesAndGainBlade(game, source, cardIds, orderedResolution, continuation)
    );
  }
  return startPendingActiveEffect(game, {
    ability: source,
    playerId: source.controllerId,
    activeEffect: {
      id: source.id,
      abilityId: source.abilityId,
      sourceCardId: source.sourceCardId,
      sourceLifecycleId: source.sourceLifecycleId,
      controllerId: source.controllerId,
      awaitingPlayerId: source.controllerId,
      effectText: getAbilityEffectText(LIVE_START),
      stepId: DECK_TOP_STEP,
      stepText: '请选择全部符合条件的LIVE卡。最先选择的卡放在卡组最上方。',
      selectableCardIds: cardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: cardIds.length,
      maxSelectableCards: cardIds.length,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      metadata: { orderedResolution },
    },
    actionPayload: { sourceCardId: source.sourceCardId, step: 'START_ORDER_AQOURS_LIVES' },
  });
}

function finishReturnLives(
  game: GameState,
  selected: readonly string[],
  continuation: Continue
): GameState {
  const effect = getCardActiveEffect(game);
  if (effect?.abilityId !== LIVE_START || effect.stepId !== DECK_TOP_STEP) return game;
  const current = getLivesBelowSource(game, effect);
  const offered = new Set(effect.selectableCardIds);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (current.length !== offered.size || current.some((id) => !offered.has(id))) {
    return finish(game, effect, orderedResolution, continuation, 'STACKED_LIVES_CHANGED');
  }
  return returnLivesAndGainBlade(game, effect, selected, orderedResolution, continuation);
}

function returnLivesAndGainBlade(
  game: GameState,
  source: AbilitySource,
  selected: readonly string[],
  orderedResolution: boolean,
  continuation: Continue
): GameState {
  const moved = selected.length
    ? moveLivesBelowStageMemberToDeckTop(game, source.controllerId, source.sourceCardId, selected)
    : null;
  const bladeBonus = moved?.movedCardIds.length ?? 0;
  const reward = moved
    ? addBladeLiveModifierForSourceMember(moved.gameState, {
        playerId: source.controllerId,
        sourceCardId: source.sourceCardId,
        abilityId: source.abilityId,
        amount: bladeBonus,
      })
    : null;
  return finish(
    reward?.gameState ?? moved?.gameState ?? game,
    source,
    orderedResolution,
    continuation,
    moved ? 'RETURN_AQOURS_LIVES_GAIN_BLADE' : 'NO_STACKED_AQOURS_LIVES',
    {
      bladeBonus: reward?.bladeBonus ?? 0,
      ...(moved && bladeBonus > 1 ? { privateMainDeckOrderCardIds: moved.movedCardIds } : {}),
    }
  );
}

function finish(
  game: GameState,
  source: AbilitySource,
  orderedResolution: boolean,
  continuation: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        activeEffect: game.activeEffect?.id === source.id ? null : game.activeEffect,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== source.id),
      },
      'RESOLVE_ABILITY',
      source.controllerId,
      {
        abilityId: source.abilityId,
        pendingAbilityId: source.id,
        sourceCardId: source.sourceCardId,
        sourceLifecycleId: source.sourceLifecycleId,
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}
