import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  finishTargetPlayerWaitOwnActiveMemberWorkflow,
  transitionToTargetPlayerWaitOwnActiveMemberStep,
  type TargetPlayerWaitOwnActiveMemberWorkflowConfig,
} from '../shared/target-player-wait-own-active-member.js';

const SELECT_BIBI_MEMBER_COST_STEP_ID = 'PB1_015_SELECT_BIBI_MEMBER_COST_TO_WAIT';
const OPPONENT_SELECT_ACTIVE_MEMBER_STEP_ID = 'PB1_015_OPPONENT_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT';

const FIRST_EFFECT_ABILITY_IDS = [
  PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
] as const;

const PB1_015_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIGS: Record<
  (typeof FIRST_EFFECT_ABILITY_IDS)[number],
  TargetPlayerWaitOwnActiveMemberWorkflowConfig
> = {
  [PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID]: {
    abilityId: PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    effectTextAbilityId:
      PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    stepId: OPPONENT_SELECT_ACTIVE_MEMBER_STEP_ID,
    stepText: '请选择自己舞台上1名活跃状态的成员变为待机状态。',
    selectionLabel: '选择自己舞台上的活跃成员',
    startActionStep: 'START_OPPONENT_SELECT_OWN_ACTIVE_MEMBER',
    finishActionStep: 'OPPONENT_WAIT_OWN_ACTIVE_MEMBER',
    noTargetActionStep: 'OPPONENT_NO_ACTIVE_TARGET_AFTER_BIBI_COST',
  },
  [PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID]: {
    abilityId: PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    effectTextAbilityId:
      PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    stepId: OPPONENT_SELECT_ACTIVE_MEMBER_STEP_ID,
    stepText: '请选择自己舞台上1名活跃状态的成员变为待机状态。',
    selectionLabel: '选择自己舞台上的活跃成员',
    startActionStep: 'START_OPPONENT_SELECT_OWN_ACTIVE_MEMBER',
    finishActionStep: 'OPPONENT_WAIT_OWN_ACTIVE_MEMBER',
    noTargetActionStep: 'OPPONENT_NO_ACTIVE_TARGET_AFTER_BIBI_COST',
  },
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const isBiBiMember = and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'));

export function registerPb1015MakiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of FIRST_EFFECT_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startPb1015FirstEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_BIBI_MEMBER_COST_STEP_ID,
      (game, input, context) =>
        finishPb1015BiBiCost(
          game,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
    registerActiveEffectStepHandler(
      abilityId,
      OPPONENT_SELECT_ACTIVE_MEMBER_STEP_ID,
      (game, input, context) =>
        finishTargetPlayerWaitOwnActiveMemberWorkflow(
          game,
          input.selectedCardId ?? null,
          PB1_015_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIGS[abilityId],
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }

  registerPendingAbilityStarterHandler(
    PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePb1015OwnEffectWaitOpponentLowCostDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function startPb1015FirstEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getOwnActiveBiBiMemberCardIds(game, player.id);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_BIBI_COST_TARGET',
        sourceSlot: ability.sourceSlot,
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
        stepId: SELECT_BIBI_MEMBER_COST_STEP_ID,
        stepText: '可以将自己舞台上1名『BiBi』成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '选择要变为待机的『BiBi』成员',
        confirmSelectionLabel: '变为待机',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
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
      step: 'START_SELECT_BIBI_MEMBER_COST',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
    }
  );
}

function finishPb1015BiBiCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !isPb1015FirstEffectAbilityId(effect.abilityId)) {
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
        step: 'SKIP_BIBI_COST',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getOwnActiveBiBiMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    player.id,
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
          paidCostCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  return transitionToTargetPlayerWaitOwnActiveMemberStep(
    stateWithCostTriggers.gameState,
    PB1_015_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIGS[effect.abilityId],
    {
      activeEffect: effect,
      targetPlayerId: opponent.id,
      actionPlayerId: player.id,
      orderedResolution,
      continuePendingCardEffects,
      metadata: {
        sourceSlot: effect.metadata?.sourceSlot,
        eventIds: effect.metadata?.eventIds,
        timingId: effect.metadata?.timingId,
        paidCostCardId: selectedCardId,
      },
      actionPayload: {
        paidCostCardId: selectedCardId,
      },
    }
  );
}

function resolvePb1015OwnEffectWaitOpponentLowCostDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_CARD',
      sourceSlot: ability.sourceSlot,
      changedCardId: ability.metadata?.changedCardId,
      changedControllerId: ability.metadata?.changedControllerId,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}

function getOwnActiveBiBiMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, isBiBiMember).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function isPb1015FirstEffectAbilityId(
  abilityId: string
): abilityId is (typeof FIRST_EFFECT_ABILITY_IDS)[number] {
  return FIRST_EFFECT_ABILITY_IDS.includes(abilityId as (typeof FIRST_EFFECT_ABILITY_IDS)[number]);
}
