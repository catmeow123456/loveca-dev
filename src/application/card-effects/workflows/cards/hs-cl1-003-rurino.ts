import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { FaceState, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_MIRACRA_MEMBER_STEP_ID = 'HS_CL1_003_SELECT_MIRACRA_MEMBER_GAIN_BLADE';
const BASE_CARD_CODE = 'PL!HS-cl1-003';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsCl1003RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
    (game, playerId, cardId) => startHsCl1003Rurino(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
    SELECT_MIRACRA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsCl1003Rurino(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1003Rurino(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const source = getValidActivatedSource(game, playerId, cardId);
  if (!source || source.sourceOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot: source.sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterUse = recordAbilityUseForContext(
    stateWithMemberStateTriggers.gameState,
    playerId,
    {
      abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
      sourceCardId: cardId,
    }
  );
  const selectableCardIds = getMiracraParkStageMemberCardIds(stateAfterUse, playerId);
  if (selectableCardIds.length === 0) {
    return addAction(stateAfterUse, 'RESOLVE_ABILITY', playerId, {
      abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'NO_TARGET_AFTER_COST',
      targetMemberCardId: null,
    });
  }

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        id: `${HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`,
        abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
        ),
        stepId: SELECT_MIRACRA_MEMBER_STEP_ID,
        stepText:
          '请选择自己舞台上1名『みらくらぱーく！』成员。LIVE结束时为止，该成员获得[BLADE]。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        selectionLabel: '选择获得[BLADE]的みらくらぱーく！成员',
        canSkipSelection: false,
        metadata: {
          sourceSlot: source.sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'START_SELECT_MIRACRA_MEMBER_GAIN_BLADE',
      selectableCardIds,
    }
  );
}

function finishHsCl1003Rurino(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_MIRACRA_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const targetStillLegal = getMiracraParkStageMemberCardIds(game, player.id).includes(
    selectedCardId
  );
  if (!targetStillLegal) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_TARGET_NOT_FOUND_AFTER_COST',
        targetMemberCardId: selectedCardId,
        bladeBonus: 0,
      }),
      false
    );
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_TARGET_NOT_FOUND_AFTER_COST',
        targetMemberCardId: selectedCardId,
        bladeBonus: 0,
      }),
      false
    );
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'MIRACRA_MEMBER_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    false
  );
}

function getValidActivatedSource(
  game: GameState,
  playerId: string,
  cardId: string
): {
  readonly sourceSlot: NonNullable<ReturnType<typeof getSourceMemberSlot>>;
  readonly sourceOrientation: OrientationState;
} | null {
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation === undefined
  ) {
    return null;
  }

  return {
    sourceSlot,
    sourceOrientation: sourceState.orientation,
  };
}

function getMiracraParkStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, unitAliasIs('みらくらぱーく！')).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.face === FaceState.FACE_UP
  );
}
