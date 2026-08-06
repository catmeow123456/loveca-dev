import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID =
  S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID;
const BASE_CARD_CODE = 'PL!S-bp7-011';
const REVEAL_STEP_ID = 'S_BP7_011_REVEAL_MILLED_BOTTOM_TWO';
const MILL_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

const aqoursMember = and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'));

export function registerSBp7011RikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, (game, playerId, cardId) =>
    startSBp7011Riko(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, REVEAL_STEP_ID, (game, _input, context) =>
    finishSBp7011Riko(game, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects)
  );
}

function startSBp7011Riko(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, sourceCardId);
  const sourceState = player?.memberSlots.cardStates.get(sourceCardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, sourceCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId,
    abilityId: ABILITY_ID,
  });
  if (!waitResult?.changed || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithWaitTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        recordPayCostAction(state, playerId, {
          abilityId: ABILITY_ID,
          sourceCardId,
          sourceSlot,
          waitedMemberCardId: sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  ).gameState;
  const stateAfterUse = recordAbilityUseForContext(stateWithWaitTriggers, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId,
  });
  const millResult = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    stateAfterUse,
    playerId,
    MILL_COUNT,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId,
        sourceCardId,
        abilityId: ABILITY_ID,
      },
    }
  );
  if (!millResult) {
    return stateAfterUse;
  }

  const movedCardIds = millResult.movedCardIds;
  const conditionMet =
    movedCardIds.length === MILL_COUNT &&
    allCardIdsMatchingSelector(millResult.gameState, movedCardIds, aqoursMember);
  if (movedCardIds.length === 0) {
    return addAction(millResult.gameState, 'RESOLVE_ABILITY', playerId, {
      abilityId: ABILITY_ID,
      sourceCardId,
      sourceSlot,
      step: 'NO_BOTTOM_CARDS_AFTER_COST',
      movedCardIds,
      conditionMet: false,
      activatedSource: false,
      bladeBonus: 0,
      refreshCount: millResult.refreshCount,
    });
  }

  const refreshText = millResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = conditionMet
    ? '这些卡全部为『Aqours』的成员卡。展示结束后，将此成员变为活跃状态，LIVE结束时为止，获得[ブレード][ブレード]。'
    : '这些卡不满足全部为『Aqours』的成员卡。展示结束后不将此成员变为活跃状态，不获得[ブレード][ブレード]。';
  const effectId = `${ABILITY_ID}:${sourceCardId}:turn-${millResult.gameState.turnCount}:action-${millResult.gameState.actionHistory.length}`;
  return addAction(
    {
      ...millResult.gameState,
      activeEffect: withPublicRevealDwell({
        id: effectId,
        abilityId: ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: REVEAL_STEP_ID,
        stepText: `已将卡组底合计${movedCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
        awaitingPlayerId: playerId,
        revealedCardIds: [...new Set(movedCardIds)],
        metadata: {
          sourceSlot,
          sourceZone: ZoneType.MAIN_DECK,
          movedCardIds,
          conditionMet,
          refreshCount: millResult.refreshCount,
        },
      }),
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: ABILITY_ID,
      sourceCardId,
      sourceSlot,
      step: 'MILL_BOTTOM_TWO_AFTER_WAIT_COST',
      movedCardIds,
      conditionMet,
      refreshCount: millResult.refreshCount,
    }
  );
}

function finishSBp7011Riko(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
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
  const stateWithoutEffect: GameState = { ...game, activeEffect: null };
  if (!conditionMet || !isValidSourceOnStage(stateWithoutEffect, player.id, effect.sourceCardId)) {
    return continuePendingCardEffects(
      addAction(stateWithoutEffect, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: conditionMet ? 'SOURCE_LEFT_STAGE_AFTER_COST' : 'CONDITION_NOT_MET',
        movedCardIds,
        conditionMet,
        activatedSource: false,
        bladeBonus: 0,
        refreshCount: readNumberMetadata(effect.metadata?.refreshCount),
      }),
      false
    );
  }

  const activateResult = setMemberOrientation(
    stateWithoutEffect,
    player.id,
    effect.sourceCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!activateResult) {
    return game;
  }

  const withActivationTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutEffect,
    activateResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterActivation, result, events) => {
        const blade = addBladeLiveModifierForSourceMember(stateAfterActivation, {
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          amount: 2,
        });
        return addAction(blade?.gameState ?? stateAfterActivation, 'RESOLVE_ABILITY', player.id, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'ACTIVATE_SELF_GAIN_TWO_BLADE',
          movedCardIds,
          conditionMet: true,
          activatedSource: result.changed,
          memberStateChangedEventIds: events.map((event) => event.eventId),
          bladeBonus: blade?.bladeBonus ?? 0,
          refreshCount: readNumberMetadata(effect.metadata?.refreshCount),
        });
      },
    }
  );
  return continuePendingCardEffects(withActivationTriggers.gameState, false);
}

function isValidSourceOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const source = getCardById(game, sourceCardId);
  return (
    source !== null &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readNumberMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
