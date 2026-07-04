import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, OrientationState, type SlotPosition } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { and, memberPrintedBladeEquals, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const SOURCE_WAIT_COST_STEP_ID = 'N_BP5_004_SELECT_SOURCE_WAIT_COST';
const OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_STEP_ID =
  'N_BP5_004_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER_TO_WAIT';

const KARIN_ABILITY_IDS = [
  PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
] as const;

const printedBladeFourMember = and(typeIs(CardType.MEMBER), memberPrintedBladeEquals(4));

export function registerNBp5004KarinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of KARIN_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startKarinWaitCostEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SOURCE_WAIT_COST_STEP_ID, (game, input, context) =>
      finishKarinSourceWaitCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(
      abilityId,
      OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_STEP_ID,
      (game, input, context) =>
        finishKarinOpponentWaitTarget(
          game,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startKarinWaitCostEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceState = getOwnSourceState(game, ability.controllerId, ability.sourceCardId);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!sourceState.sourceSlot || sourceState.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_SOURCE_NOT_ACTIVE',
        sourceSlot: sourceState.sourceSlot,
        sourceOrientation: sourceState.orientation,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SOURCE_WAIT_COST_STEP_ID,
        stepText: '可以将此成员变为待机状态。如此做后，选择对方舞台上1名原本BLADE正好4个且当前非待机的成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds: [ability.sourceCardId],
        selectionLabel: '选择此成员支付待机成本',
        confirmSelectionLabel: '变为待机',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: sourceState.sourceSlot,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_SOURCE_WAIT_COST',
      sourceSlot: sourceState.sourceSlot,
    }
  );
}

function finishKarinSourceWaitCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !isKarinAbilityId(effect.abilityId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_SOURCE_WAIT_COST',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }

  if (selectedCardId !== effect.sourceCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const sourceState = getOwnSourceState(game, player.id, effect.sourceCardId);
  if (!sourceState.sourceSlot || sourceState.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_SOURCE_NOT_ACTIVE_AT_COST',
        sourceSlot: sourceState.sourceSlot,
        sourceOrientation: sourceState.orientation,
      }),
      orderedResolution
    );
  }

  const orientationChange = setMemberOrientation(
    game,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithCostTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(state, 'PAY_COST', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          paidCostCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  const targetCardIds = getOpponentOriginalBladeFourActiveMemberIds(
    stateWithCostTriggers.gameState,
    opponent.id
  );
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...stateWithCostTriggers.gameState,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'NO_OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_AFTER_COST',
          sourceSlot: sourceState.sourceSlot,
          paidCostCardId: effect.sourceCardId,
          targetPlayerId: opponent.id,
        }
      ),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithCostTriggers.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_STEP_ID,
        stepText: '请选择对方舞台上1名原本BLADE正好4个且当前非待机的成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds: targetCardIds,
        selectionLabel: '选择对方舞台上原本BLADE正好4个的成员',
        confirmSelectionLabel: '变为待机',
        metadata: {
          orderedResolution,
          sourceSlot: sourceState.sourceSlot,
          paidCostCardId: effect.sourceCardId,
          targetPlayerId: opponent.id,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
      sourceSlot: sourceState.sourceSlot,
      paidCostCardId: effect.sourceCardId,
      targetPlayerId: opponent.id,
      selectableCardIds: targetCardIds,
    }
  );
}

function finishKarinOpponentWaitTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !isKarinAbilityId(effect.abilityId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!player || !targetPlayerId || selectedCardId === null) {
    return game;
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getOpponentOriginalBladeFourActiveMemberIds(game, targetPlayerId).includes(selectedCardId)
  ) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    targetPlayerId,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithTargetTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
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
            step: 'WAIT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
            sourceSlot: effect.metadata?.sourceSlot,
            paidCostCardId:
              typeof effect.metadata?.paidCostCardId === 'string'
                ? effect.metadata.paidCostCardId
                : undefined,
            targetPlayerId,
            targetCardId: selectedCardId,
            targetPrintedBlade: 4,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithTargetTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getOwnSourceState(
  game: GameState,
  playerId: string,
  sourceCardId: string
): {
  readonly sourceSlot: SlotPosition | null;
  readonly orientation: OrientationState | null;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { sourceSlot: null, orientation: null };
  }

  const sourceSlot = findMemberSlot(player, sourceCardId);
  return {
    sourceSlot,
    orientation: sourceSlot ? player.memberSlots.cardStates.get(sourceCardId)?.orientation ?? null : null,
  };
}

function getOpponentOriginalBladeFourActiveMemberIds(
  game: GameState,
  opponentId: string
): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  return getStageMemberCardIdsMatching(game, opponentId, printedBladeFourMember).filter(
    (cardId) =>
      opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function isKarinAbilityId(abilityId: string): abilityId is (typeof KARIN_ABILITY_IDS)[number] {
  return KARIN_ABILITY_IDS.includes(abilityId as (typeof KARIN_ABILITY_IDS)[number]);
}
