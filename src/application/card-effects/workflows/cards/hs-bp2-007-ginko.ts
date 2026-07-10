import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { getCardNameCandidates } from '../../../../shared/utils/card-identity.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { cardNameAliasAny, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
  HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { evaluateRelayEnterLowerCostUnitCondition } from '../shared/relay-enter-lower-cost-unit.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_BP2_007_SELECT_WAITING_ROOM_LIVE';
const SELECT_DISCARD_HAND_STEP_ID = 'HS_BP2_007_SELECT_DISCARD_HAND';
const SELECT_SAME_NAME_TARGET_STEP_ID = 'HS_BP2_007_SELECT_SAME_NAME_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2007GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startOnEnterRecoverLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
    SELECT_DISCARD_HAND_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishDiscardHand(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
    SELECT_SAME_NAME_TARGET_STEP_ID,
    (game, input, context) =>
      finishSameNameTarget(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startOnEnterRecoverLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LEFT_STAGE'
    );
  }

  const condition = evaluateRelayEnterLowerCostUnitCondition(
    game,
    {
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      relayReplacements: ability.metadata?.relayReplacements,
    },
    'Cerise Bouquet'
  );
  if (!condition.conditionMet) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      condition.reason,
      {
        sourceEffectiveCost: condition.sourceEffectiveCost,
        relayReplacementCardIds: condition.relayReplacementCardIds,
        matchingRelayReplacementCardIds: condition.matchingRelayReplacementCardIds,
        capturedReplacementEffectiveCosts: condition.capturedReplacementEffectiveCosts,
      }
    );
  }

  const selectableCardIds = getWaitingRoomHasunosoraLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_WAITING_ROOM_HASUNOSORA_LIVE_TARGET'
    );
  }

  return startWaitingRoomToHandWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
    stepText: '请选择自己的休息室中1张『莲之空』的LIVE卡加入手牌。',
    selectionLabel: '选择要加入手牌的LIVE卡',
    confirmSelectionLabel: '加入手牌',
    candidateBuilder: getWaitingRoomHasunosoraLiveCardIds,
    countRule: { exactCount: 1 },
    optional: false,
    orderedResolution,
  });
}

function startLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LEFT_STAGE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_HAND_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText:
        '可以将1张手牌放置入休息室。若放置的是成员卡，选择己方舞台上持有相同名称的1名成员获得[緑ハート][ブレード]。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_HAND',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardHand(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getLiveStartEffect(game, SELECT_DISCARD_HAND_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const discardedCard = getCardById(game, selectedCardId);
  if (
    !effect ||
    !player ||
    !discardedCard ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const stateAfterCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  if (!isMemberCardData(discardedCard.data)) {
    return finishActiveEffect(stateAfterCost, effect, continuePendingCardEffects, {
      step: 'DISCARD_NON_MEMBER_NO_TARGET',
      discardedCardId: selectedCardId,
      targetCardId: null,
      heartBonus: [],
      bladeBonus: 0,
    });
  }

  const targetCardIds = getSameNameStageMemberIds(stateAfterCost, player.id, discardedCard.data);
  if (targetCardIds.length === 0) {
    return finishActiveEffect(stateAfterCost, effect, continuePendingCardEffects, {
      step: 'DISCARD_MEMBER_NO_SAME_NAME_TARGET',
      discardedCardId: selectedCardId,
      targetCardId: null,
      heartBonus: [],
      bladeBonus: 0,
    });
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: SELECT_SAME_NAME_TARGET_STEP_ID,
        stepText: '请选择己方舞台上持有与弃置成员卡相同名称的1名成员。',
        awaitingPlayerId: player.id,
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择获得[緑ハート][ブレード]的成员',
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_SAME_NAME_TARGET',
      discardedCardId: selectedCardId,
      selectableCardIds: targetCardIds,
    }
  );
}

function finishSameNameTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getLiveStartEffect(game, SELECT_SAME_NAME_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const discardedCardId = effect ? getStringMetadata(effect, 'discardedCardId') : null;
  const discardedCard = discardedCardId ? getCardById(game, discardedCardId) : null;
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    !discardedCard ||
    !isMemberCardData(discardedCard.data) ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getSameNameStageMemberIds(game, player.id, discardedCard.data).includes(selectedCardId)
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    }
  );
  if (!heartResult) {
    return game;
  }
  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_MEMBER_TARGET_SAME_NAME_GAIN_GREEN_HEART_BLADE',
      discardedCardId,
      targetCardId: selectedCardId,
      heartBonus: heartResult.heartBonus,
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingRoomHasunosoraLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(
    game,
    playerId,
    (card) => typeIs(CardType.LIVE)(card) && groupAliasIs('蓮ノ空')(card)
  );
}

function getSameNameStageMemberIds(
  game: GameState,
  playerId: string,
  discardedCardData: Parameters<typeof getCardNameCandidates>[0]
): readonly string[] {
  const names = getCardNameCandidates(discardedCardData);
  return names.length === 0
    ? []
    : getStageMemberCardIdsMatching(game, playerId, cardNameAliasAny(names));
}

function getLiveStartEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_OP',
      reason,
      ...payload,
    }),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringMetadata(effect: ActiveEffectState, key: string): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}
