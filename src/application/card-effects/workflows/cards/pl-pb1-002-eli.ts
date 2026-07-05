import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  and,
  memberPrintedBladeLte,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
  PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAIT_SOURCE_COST_STEP_ID = 'PL_PB1_002_WAIT_SOURCE_COST';
const SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID =
  'PL_PB1_002_SELECT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBER_TO_WAIT';
const WAIT_SOURCE_OPTION_ID = 'WAIT_SOURCE';

const FIRST_EFFECT_ABILITY_IDS = [
  PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
  PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
] as const;

type FirstEffectAbilityId = (typeof FIRST_EFFECT_ABILITY_IDS)[number];
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const bibiMemberSelector = and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'));
const lowOriginalBladeMemberSelector = and(typeIs(CardType.MEMBER), memberPrintedBladeLte(3));

export function registerPlPb1002EliWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of FIRST_EFFECT_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startEliWaitSelfCost(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, WAIT_SOURCE_COST_STEP_ID, (game, input, context) =>
      finishEliWaitSelfCost(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(
      abilityId,
      SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID,
      (game, input, context) =>
        finishEliWaitOpponentLowOriginalBladeMember(
          game,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startEliWaitSelfCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const sourceOrientation = player?.memberSlots.cardStates.get(ability.sourceCardId)?.orientation;
  if (!player || sourceSlot === null) {
    return consumePendingNoOp(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      sourceSlot,
    });
  }
  if (sourceOrientation === OrientationState.WAITING) {
    return consumePendingNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_ALREADY_WAITING',
      sourceSlot,
    });
  }

  const ownStageMemberCount = getOwnStageMemberCardIds(game, player.id).length;
  const ownStageOnlyBiBi = areOwnStageMembersOnlyBiBi(game, player.id);
  const opponent = getOpponent(game, player.id);
  const opponentTargetCount = opponent
    ? getOpponentLowOriginalBladeNonWaitingMemberIds(game, opponent.id).length
    : 0;
  const effectText = `${getAbilityEffectText(
    ability.abilityId
  )}（当前自己舞台成员 ${ownStageMemberCount}名，${
    ownStageOnlyBiBi ? '均为BiBi' : '并非只有BiBi'
  }；对方合法目标 ${opponentTargetCount}名。）`;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText,
      stepId: WAIT_SOURCE_COST_STEP_ID,
      stepText: '可以发动此效果，将此成员变为待机状态。支付后会重新检查自己舞台是否只有『BiBi』成员。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: WAIT_SOURCE_OPTION_ID, label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
        timingId: ability.timingId,
        eventIds: ability.eventIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_WAIT_SOURCE_COST',
      sourceSlot,
      ownStageMemberCount,
      ownStageOnlyBiBi,
      opponentTargetCount,
    },
  });
}

function finishEliWaitSelfCost(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    !isFirstEffectAbilityId(effect.abilityId) ||
    effect.stepId !== WAIT_SOURCE_COST_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_WAIT_SOURCE_COST',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }
  if (selectedOptionId !== WAIT_SOURCE_OPTION_ID) {
    return game;
  }
  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const sourceOrientation = player.memberSlots.cardStates.get(effect.sourceCardId)?.orientation;
  if (sourceSlot === null || sourceOrientation === OrientationState.WAITING) {
    return game;
  }

  const waitResult = setMemberOrientation(
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
  if (!waitResult) {
    return game;
  }

  const stateWithCostTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
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
  return transitionToOpponentTargetSelection(
    stateWithCostTriggers.gameState,
    effect,
    player.id,
    orderedResolution,
    continuePendingCardEffects
  );
}

function transitionToOpponentTargetSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const opponent = getOpponent(game, playerId);
  const ownStageMemberIds = getOwnStageMemberCardIds(game, playerId);
  const ownStageOnlyBiBi = areOwnStageMembersOnlyBiBi(game, playerId);
  if (!opponent || !ownStageOnlyBiBi) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_COST_CONDITION_NOT_MET',
        sourceSlot: effect.metadata?.sourceSlot,
        ownStageMemberCount: ownStageMemberIds.length,
        ownStageOnlyBiBi,
      }),
      orderedResolution
    );
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      mandatory: true,
      timingId:
        effect.abilityId ===
        PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID
          ? TriggerCondition.ON_ENTER_STAGE
          : TriggerCondition.ON_LIVE_START,
      eventIds: [],
    },
    effectText: getAbilityEffectText(effect.abilityId),
    stepId: SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本[BLADE]小于等于3，且当前非待机状态的成员变为待机状态。',
    awaitingPlayerId: playerId,
    targetPlayerId: opponent.id,
    selector: lowOriginalBladeMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上原本[BLADE]小于等于3的成员',
    orderedResolution,
    metadata: {
      ...effect.metadata,
      paidCostCardId: effect.sourceCardId,
      ownStageMemberCount: ownStageMemberIds.length,
      ownStageOnlyBiBi,
    },
  });

  if (targetSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_COST_NO_OPPONENT_TARGET',
        sourceSlot: effect.metadata?.sourceSlot,
        targetPlayerId: opponent.id,
        ownStageMemberCount: ownStageMemberIds.length,
        ownStageOnlyBiBi,
        opponentTargetCount: 0,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBER',
      sourceSlot: effect.metadata?.sourceSlot,
      targetPlayerId: opponent.id,
      ownStageMemberCount: ownStageMemberIds.length,
      ownStageOnlyBiBi,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishEliWaitOpponentLowOriginalBladeMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    !isFirstEffectAbilityId(effect.abilityId) ||
    effect.stepId !== SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (
    !player ||
    !opponent ||
    !getOpponentLowOriginalBladeNonWaitingMemberIds(game, opponent.id).includes(selectedCardId)
  ) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
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
            step: 'WAIT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBER',
            sourceSlot: effect.metadata?.sourceSlot,
            targetPlayerId: opponent.id,
            targetCardId: selectedCardId,
            paidCostCardId: effect.metadata?.paidCostCardId,
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

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function areOwnStageMembersOnlyBiBi(game: GameState, playerId: string): boolean {
  const stageMemberIds = getOwnStageMemberCardIds(game, playerId);
  return (
    stageMemberIds.length > 0 &&
    stageMemberIds.every((cardId) =>
      getStageMemberCardIdsMatching(game, playerId, bibiMemberSelector).includes(cardId)
    )
  );
}

function getOpponentLowOriginalBladeNonWaitingMemberIds(
  game: GameState,
  opponentId: string
): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  return getStageMemberCardIdsMatching(game, opponentId, lowOriginalBladeMemberSelector).filter(
    (cardId) => opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function isFirstEffectAbilityId(abilityId: string): abilityId is FirstEffectAbilityId {
  return FIRST_EFFECT_ABILITY_IDS.includes(abilityId as FirstEffectAbilityId);
}
