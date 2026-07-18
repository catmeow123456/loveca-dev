import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  FaceState,
  OrientationState,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
  PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAIT_SELF_COST_STEP_ID = 'LIVE_START_WAIT_SELF_COST_FOR_CENTER_MUSE_BLADE';
const ACTIVATE_WAIT_SELF_COST_OPTION_ID = 'activate';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

interface LiveStartWaitSelfCenterMuseGainBladeConfig {
  readonly abilityId: string;
  readonly bladeAmount: number;
  readonly resolvedActionStep: string;
}

const WORKFLOW_CONFIGS: readonly LiveStartWaitSelfCenterMuseGainBladeConfig[] = [
  {
    abilityId: PL_BP4_011_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE_ABILITY_ID,
    bladeAmount: 2,
    resolvedActionStep: 'WAIT_SELF_CENTER_MUSE_GAIN_TWO_BLADE',
  },
  {
    abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    bladeAmount: 1,
    resolvedActionStep: 'WAIT_SELF_CENTER_MUSE_GAIN_BLADE',
  },
];

export function registerLiveStartWaitSelfCenterMuseGainBladeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of WORKFLOW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartWaitSelfCenterMuseGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, WAIT_SELF_COST_STEP_ID, (game, input, context) =>
      finishLiveStartWaitSelfCenterMuseGainBlade(
        game,
        input.selectedOptionId ?? null,
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startLiveStartWaitSelfCenterMuseGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartWaitSelfCenterMuseGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getActiveStageMemberSlot(game, player.id, ability.sourceCardId);
  if (!sourceSlot) {
    const sourceState = player.memberSlots.cardStates.get(ability.sourceCardId);
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER',
        sourceSlot: getSourceMemberSlot(game, player.id, ability.sourceCardId),
        sourceOrientation: sourceState?.orientation ?? null,
      }
    );
  }

  const bladeTokens = '[ブレード]'.repeat(config.bladeAmount);
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: WAIT_SELF_COST_STEP_ID,
        stepText: `可以将此成员变为待机状态。如此做的场合，自己的中央区域的『μ's』成员获得${bladeTokens}。`,
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: ACTIVATE_WAIT_SELF_COST_OPTION_ID, label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot,
          eventIds: ability.eventIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_WAIT_SELF_COST_FOR_CENTER_MUSE_BLADE',
      sourceSlot,
      bladeBonus: config.bladeAmount,
    }
  );
}

function finishLiveStartWaitSelfCenterMuseGainBlade(
  game: GameState,
  selectedOptionId: string | null,
  config: LiveStartWaitSelfCenterMuseGainBladeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== WAIT_SELF_COST_STEP_ID || effect.abilityId !== config.abilityId) {
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
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_WAIT_SELF_COST',
      }),
      orderedResolution
    );
  }
  if (
    selectedOptionId !== ACTIVATE_WAIT_SELF_COST_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const sourceSlot = getActiveStageMemberSlot(game, player.id, effect.sourceCardId);
  if (!sourceSlot) {
    const sourceState = player.memberSlots.cardStates.get(effect.sourceCardId);
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: getSourceMemberSlot(game, player.id, effect.sourceCardId),
        step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER_AFTER_SELECTION',
        sourceOrientation: sourceState?.orientation ?? null,
      }),
      orderedResolution
    );
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
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'PAY_COST', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot,
          waitedMemberCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const stateAfterCost = stateWithMemberStateTriggers.gameState;
  const targetMemberCardId = getCenterMuseMemberCardId(stateAfterCost, player.id);
  if (!targetMemberCardId) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot,
        step: 'NO_OP_NO_CENTER_MUSE_MEMBER_AFTER_COST',
        targetMemberCardId: null,
        bladeBonus: 0,
      }),
      orderedResolution
    );
  }

  const bladeResult = addBladeLiveModifierForSourceMember(stateAfterCost, {
    playerId: player.id,
    sourceCardId: targetMemberCardId,
    abilityId: effect.abilityId,
    amount: config.bladeAmount,
  });
  if (!bladeResult) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot,
        step: 'NO_OP_CENTER_MUSE_MEMBER_INVALID_AFTER_COST',
        targetMemberCardId,
        bladeBonus: 0,
      }),
      orderedResolution
    );
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: config.resolvedActionStep,
      targetMemberCardId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    orderedResolution
  );
}

function finishPendingNoOp(
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

function getActiveStageMemberSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  const sourceSlot = getSourceMemberSlot(game, playerId, sourceCardId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceState = sourceSlot ? player?.memberSlots.cardStates.get(sourceCardId) : undefined;
  if (
    !sourceSlot ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return null;
  }
  return sourceSlot;
}

function getCenterMuseMemberCardId(game: GameState, playerId: string): string | null {
  const player = getPlayerById(game, playerId);
  const centerCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  if (!centerCardId) {
    return null;
  }
  const card = getCardById(game, centerCardId);
  if (!card || !isMemberCardData(card.data) || !groupAliasIs("μ's")(card)) {
    return null;
  }
  const centerState = player?.memberSlots.cardStates.get(centerCardId);
  return centerState?.face === FaceState.FACE_UP ? centerCardId : null;
}
