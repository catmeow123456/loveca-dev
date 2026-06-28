import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_LIELLA_MEMBER_STEP_ID = 'SP_PB2_009_SELECT_LIELLA_MEMBER_TO_WAIT';
const SELECT_OPPONENT_MEMBER_STEP_ID = 'SP_PB2_009_SELECT_OPPONENT_LOWER_BLADE_MEMBER_TO_WAIT';

const SP_PB2_009_ABILITY_IDS = [
  SP_PB2_009_ON_ENTER_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
  SP_PB2_009_LIVE_START_WAIT_LIELLA_MEMBER_WAIT_OPPONENT_LOWER_PRINTED_BLADE_ABILITY_ID,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const liellaMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerSpPb2009NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of SP_PB2_009_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startSpPb2009NatsumiWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_LIELLA_MEMBER_STEP_ID, (game, input, context) =>
      finishSelectLiellaMemberToWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_OPPONENT_MEMBER_STEP_ID, (game, input, context) =>
      finishSelectOpponentMemberToWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startSpPb2009NatsumiWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_LIELLA_MEMBER_STEP_ID,
    stepText:
      '可以将自己舞台上的1名『Liella!』成员变为待机状态。若如此做，将按该成员原本 BLADE 选择对方成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector: createPlayableLiellaMemberSelector(game, opponent.id),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的 Liella! 成员',
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
      opponentPlayerId: opponent.id,
    },
  });

  if (targetSelection.activeEffect === null) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_LIELLA_MEMBER_OR_OPPONENT_TARGET',
        sourceSlot: ability.sourceSlot,
        opponentPlayerId: opponent.id,
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...targetSelection.activeEffect,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIELLA_MEMBER_TO_WAIT',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: targetSelection.selectableCardIds,
      opponentPlayerId: opponent.id,
    },
  });
}

function finishSelectLiellaMemberToWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_LIELLA_MEMBER_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponentPlayerId =
    typeof effect.metadata?.opponentPlayerId === 'string' ? effect.metadata.opponentPlayerId : null;
  if (!player || !opponentPlayerId) {
    return game;
  }

  if (selectedCardId === null) {
    if (effect.canSkipSelection !== true) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_WAIT_LIELLA_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const waitedCard = getCardById(game, selectedCardId);
  const waitedPrintedBlade =
    waitedCard !== null && isMemberCardData(waitedCard.data) ? waitedCard.data.blade : null;
  if (waitedPrintedBlade === null) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_LIELLA_MEMBER',
            waitedLiellaMemberId: selectedCardId,
            waitedLiellaPrintedBlade: waitedPrintedBlade,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  const nextState = stateWithMemberStateTriggers.gameState;
  const opponentTargetIds = getOpponentLowerPrintedBladeTargetIds(
    nextState,
    opponentPlayerId,
    waitedPrintedBlade
  );
  if (opponentTargetIds.length === 0) {
    return continuePendingCardEffects(
      addAction(nextState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_NO_OPPONENT_TARGET_AFTER_WAIT_LIELLA_MEMBER',
        waitedLiellaMemberId: selectedCardId,
        waitedLiellaPrintedBlade: waitedPrintedBlade,
        opponentPlayerId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...nextState,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText:
        '请选择对方舞台上1名原本 BLADE 比待机的 Liella! 成员少2个以上的成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds: opponentTargetIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择对方原本 BLADE 较少的成员',
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        stageMemberOrientationTarget: true,
        targetPlayerId: opponentPlayerId,
        targetOrientation: OrientationState.WAITING,
        waitedLiellaMemberId: selectedCardId,
        waitedLiellaPrintedBlade: waitedPrintedBlade,
      },
    },
  };
}

function finishSelectOpponentMemberToWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId);
  if (!orientationChange) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_OPPONENT_TARGET_UNAVAILABLE',
        waitedLiellaMemberId: effect.metadata?.waitedLiellaMemberId ?? null,
        waitedLiellaPrintedBlade: effect.metadata?.waitedLiellaPrintedBlade ?? null,
        targetCardId: selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_LOWER_PRINTED_BLADE_MEMBER',
            waitedLiellaMemberId: effect.metadata?.waitedLiellaMemberId ?? null,
            waitedLiellaPrintedBlade: effect.metadata?.waitedLiellaPrintedBlade ?? null,
            targetPlayerId: effect.metadata?.targetPlayerId ?? null,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function createPlayableLiellaMemberSelector(
  game: GameState,
  opponentPlayerId: string
): CardSelector {
  return (card) => {
    if (!liellaMemberSelector(card) || !isMemberCardData(card.data)) {
      return false;
    }
    return getOpponentLowerPrintedBladeTargetIds(game, opponentPlayerId, card.data.blade).length > 0;
  };
}

function getOpponentLowerPrintedBladeTargetIds(
  game: GameState,
  opponentPlayerId: string,
  waitedPrintedBlade: number
): readonly string[] {
  const maxOpponentPrintedBlade = waitedPrintedBlade - 2;
  if (maxOpponentPrintedBlade < 0) {
    return [];
  }
  const opponent = getPlayerById(game, opponentPlayerId);
  if (!opponent) {
    return [];
  }

  return getStageMemberCardIdsMatching(game, opponentPlayerId, (card) => {
    const orientation = opponent.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return (
      orientation !== OrientationState.WAITING &&
      isMemberCardData(card.data) &&
      card.data.blade <= maxOpponentPrintedBlade
    );
  });
}
