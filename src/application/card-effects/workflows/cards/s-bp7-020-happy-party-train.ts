import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { S_BP7_020_LIVE_START_MILL_BOTTOM_ONE_AQOURS_MEMBER_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ABILITY_ID =
  S_BP7_020_LIVE_START_MILL_BOTTOM_ONE_AQOURS_MEMBER_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!S-bp7-020-SECL';
const REVEAL_STEP_ID = 'S_BP7_020_REVEAL_MILLED_BOTTOM_ONE';

export function registerSBp7020HappyPartyTrainWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startHappyPartyTrainBottomMillReveal(
      game,
      ability,
      options.orderedResolution === true,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, REVEAL_STEP_ID, (game, _input, context) =>
    finishHappyPartyTrainBottomMill(game, context.continuePendingCardEffects)
  );
}

function startHappyPartyTrainBottomMillReveal(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isValidSourceLive(game, player.id, ability.sourceCardId)) {
    return finishNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_LIVE_ZONE'
    );
  }

  const moveResult = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    1,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!moveResult) {
    return game;
  }

  const movedCardIds = moveResult.movedCardIds;
  const conditionMet =
    movedCardIds.length === 1 &&
    allCardIdsMatchingSelector(
      moveResult.gameState,
      movedCardIds,
      and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'))
    );
  const refreshText = moveResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = conditionMet
    ? '这张卡为『Aqours』成员卡。确认后此LIVE所需的[無ハート]减少1个。'
    : '这张卡不为『Aqours』成员卡。确认后不减少此LIVE所需的[無ハート]。';

  return startPendingActiveEffect(moveResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: REVEAL_STEP_ID,
      stepText: `已将卡组底合计${movedCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(movedCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        movedCardIds,
        conditionMet,
        refreshCount: moveResult.refreshCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_BOTTOM_CARDS',
      movedCardIds,
      conditionMet,
      refreshCount: moveResult.refreshCount,
    },
  });
}

function finishHappyPartyTrainBottomMill(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== REVEAL_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const movedCardIds = getStringArrayMetadata(effect.metadata?.movedCardIds);
  const conditionMet = effect.metadata?.conditionMet === true;
  const sourceValid = isValidSourceLive(game, player.id, effect.sourceCardId);
  const replacement: LiveModifierState | null =
    conditionMet && sourceValid
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null;
  const stateAfterModifier = replaceLiveModifier(
    { ...game, activeEffect: null },
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    replacement
  );

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MILL_BOTTOM_ONE_AQOURS_MEMBER_REDUCE_COLORLESS_REQUIREMENT',
      movedCardIds,
      refreshCount:
        typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
      conditionMet,
      requirementReduction: replacement ? 1 : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function finishNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      movedCardIds: [],
      conditionMet: false,
      requirementReduction: 0,
    }
  );
  return continuePendingCardEffects(state, orderedResolution);
}
