import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { addPlayerScoreLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT_WAIT_COST_TARGET_STEP_ID = 'S_BP3_001_SELECT_WAIT_COST_TARGET';
const BASE_CARD_CODE = 'PL!S-bp3-001';

export function registerSBp3001ChikaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID,
    (game, playerId, cardId) => startSBp3001Chika(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID,
    SELECT_WAIT_COST_TARGET_STEP_ID,
    (game, input, context) =>
      finishSBp3001Chika(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects, context.continuePendingCardEffects)
  );
}

function getOwnActiveMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return !player
    ? []
    : getStageMemberCardIdsMatching(game, player.id, typeIs(CardType.MEMBER)).filter(
        (cardId) => player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
      );
}

function sourceIsValid(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!source &&
    source.ownerId === player.id &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    getSourceMemberSlot(game, player.id, sourceCardId) === SlotPosition.CENTER
  );
}

function startSBp3001Chika(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  if (game.players[game.activePlayerIndex]?.id !== playerId || !sourceIsValid(game, playerId, sourceCardId)) return game;
  const selectableCardIds = getOwnActiveMemberCardIds(game, playerId);
  if (selectableCardIds.length === 0) return game;
  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID),
        stepId: SELECT_WAIT_COST_TARGET_STEP_ID,
        stepText: '请选择自己舞台上的1名活跃状态成员变为待机状态。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要变为待机状态的成员',
        confirmSelectionLabel: '变为待机状态',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    { abilityId: S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID, sourceCardId, step: 'START_SELECT_WAIT_COST_TARGET', selectableCardIds }
  );
}

function finishSBp3001Chika(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID || effect.stepId !== SELECT_WAIT_COST_TARGET_STEP_ID || !selectedCardId) return game;
  if (!sourceIsValid(game, effect.controllerId, effect.sourceCardId)) return { ...game, activeEffect: null };
  const currentTargets = getOwnActiveMemberCardIds(game, effect.controllerId);
  if (!effect.selectableCardIds?.includes(selectedCardId) || !currentTargets.includes(selectedCardId)) return game;
  const waitResult = setMemberOrientation(game, effect.controllerId, selectedCardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT', playerId: effect.controllerId, sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  if (!waitResult || !waitResult.changed || waitResult.previousOrientation !== OrientationState.ACTIVE) return game;
  const stateWithModifier = addPlayerScoreLiveModifierForTargetMember(waitResult.gameState, {
    playerId: effect.controllerId, targetMemberCardId: selectedCardId, sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId, countDelta: 1,
  });
  if (!stateWithModifier) return game;
  const settled = recordAbilityUseForContext(
    recordPayCostAction({ ...stateWithModifier.gameState, activeEffect: null }, effect.controllerId, {
      abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, waitedMemberCardId: selectedCardId,
      previousOrientation: waitResult.previousOrientation, nextOrientation: waitResult.nextOrientation,
    }), effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId }
  );
  const withTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { ...waitResult, gameState: settled },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, _orientationResult, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE',
          targetMemberCardId: selectedCardId,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(withTriggers.gameState, false);
}
