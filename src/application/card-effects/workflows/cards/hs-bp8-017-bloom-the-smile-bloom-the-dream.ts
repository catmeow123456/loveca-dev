import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP8_017_LIVE_START_RETURN_SELF_DISCARD_TARGET_LIVE_SCORE_REQUIREMENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { returnLiveZoneCardToHandForPlayer } from '../../runtime/actions.js';
import {
  getAbilitySourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const DISCARD_STEP = 'HS_BP8_017_DISCARD_AFTER_RETURN';
const TARGET_STEP = 'HS_BP8_017_SELECT_LIVE_SCORE_REQUIREMENT_TARGET';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerHsBp8017BloomTheSmileBloomTheDreamWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    DISCARD_STEP,
    (game, input, context) => {
      const effect = game.activeEffect;
      if (!effect || !input.selectedCardId) return game;
      const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        input.selectedCardId,
        { candidateCardIds: effect.selectableCardIds ?? [] },
        deps.enqueueTriggeredCardEffects
      );
      if (!discard) return game;
      const targets = liveTargets(discard.gameState, effect.controllerId);
      if (targets.length === 0)
        return complete(
          discard.gameState,
          effect,
          context.continuePendingCardEffects,
          'NO_REMAINING_LIVE_TARGET'
        );
      return {
        ...discard.gameState,
        activeEffect: {
          ...effect,
          stepId: TARGET_STEP,
          stepText:
            '请选择自己的LIVE卡区的1张卡片，使其分数＋1、必要HEART增加[無ハート][無ハート]。',
          selectableCardIds: targets,
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          minSelectableCards: 1,
          maxSelectableCards: 1,
          selectionLabel: '选择要增加分数及必要HEART的LIVE卡',
          confirmSelectionLabel: '增加分数及必要HEART',
          canSkipSelection: false,
          metadata: {
            ...effect.metadata,
            discardedCardIds: discard.discardedCardIds,
            targetLifecycleIds: Object.fromEntries(
              targets.map((id) => [
                id,
                getAbilitySourceLifecycleId(discard.gameState, ABILITY_ID, id),
              ])
            ),
          },
        },
      };
    },
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET_STEP,
    (game, input, context) => {
      const effect = game.activeEffect;
      if (
        !effect ||
        !input.selectedCardId ||
        !effect.selectableCardIds?.includes(input.selectedCardId)
      )
        return game;
      const targetLifecycles = effect.metadata?.targetLifecycleIds as
        Readonly<Record<string, unknown>> | undefined;
      const targets = liveTargets(game, effect.controllerId).filter(
        (id) =>
          effect.selectableCardIds?.includes(id) &&
          targetLifecycles?.[id] === getAbilitySourceLifecycleId(game, ABILITY_ID, id)
      );
      if (!targets.includes(input.selectedCardId))
        return targets.length === 0
          ? complete(game, effect, context.continuePendingCardEffects, 'LIVE_TARGET_LEFT')
          : { ...game, activeEffect: { ...effect, selectableCardIds: targets } };
      let state = addLiveModifier(game, {
        kind: 'SCORE',
        playerId: effect.controllerId,
        liveCardId: input.selectedCardId,
        countDelta: 1,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
      });
      state = addLiveModifier(state, {
        kind: 'REQUIREMENT',
        liveCardId: input.selectedCardId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: 2 }],
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
      });
      return complete(
        state,
        effect,
        context.continuePendingCardEffects,
        'TARGET_LIVE_SCORE_AND_REQUIREMENT',
        {
          targetLiveCardId: input.selectedCardId,
          discardedCardIds: effect.metadata?.discardedCardIds,
        }
      );
    },
    queryCardSelection
  );
}

function liveTargets(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.liveZone.cardIds.filter((id) => {
      const card = getCardById(game, id);
      return card !== null && card.ownerId === playerId && isLiveCardData(card.data);
    }) ?? []
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const player = getPlayerById(game, ability.controllerId);
  const source = getCardById(game, ability.sourceCardId);
  const conditionMet =
    isCurrentLiveCardAbilitySource(game, { ...ability, sourceLifecycleId }) &&
    player !== null &&
    source !== null &&
    source.ownerId === player.id &&
    isLiveCardData(source.data) &&
    player.liveZone.cardIds.includes(source.instanceId) &&
    player.liveZone.cardIds.length >= 2 &&
    player.liveZone.cardIds.every((id) => {
      const card = getCardById(game, id);
      return card !== null && card.ownerId === player.id && groupAliasIs('蓮ノ空')(card);
    });
  if (!conditionMet) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: `${getAbilityEffectText(ABILITY_ID)}（当前不满足自己LIVE卡区至少2张且仅为『莲之空』的条件，本次不回手、不弃牌，也不增加分数或必要HEART。）`,
    });
    if (confirmation) return confirmation;
    return next(
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
          step: 'CONDITION_NOT_MET',
        }
      ),
      options.orderedResolution === true
    );
  }
  const returned = returnLiveZoneCardToHandForPlayer(
    game,
    ability.controllerId,
    ability.sourceCardId
  );
  if (!returned) return game;
  const hand = getPlayerById(returned.gameState, ability.controllerId)!.hand.cardIds;
  return startPendingActiveEffect(returned.gameState, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: DISCARD_STEP,
      stepText: '请选择1张手牌放置入休息室。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: hand,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: { orderedResolution: options.orderedResolution === true },
    },
    actionPayload: {
      step: 'RETURN_SOURCE_TO_HAND_START_DISCARD',
      movedCardIds: [ability.sourceCardId],
      enterHandEventId: returned.enterHandEvent.eventId,
    },
  });
}

function complete(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
