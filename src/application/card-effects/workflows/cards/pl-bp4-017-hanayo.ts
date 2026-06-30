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
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAIT_SELF_COST_STEP_ID = 'BP4_017_WAIT_SELF_COST_FOR_CENTER_MUSE_BLADE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const museMemberSelector = (cardId: string, game: GameState): boolean => {
  const card = getCardById(game, cardId);
  return card !== null && typeIsMemberMuse(card);
};

export function registerPlBp4017HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startBp4017HanayoLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    WAIT_SELF_COST_STEP_ID,
    (game, input, context) =>
      finishBp4017HanayoWaitSelfCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startBp4017HanayoLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  const sourceState = sourceSlot
    ? player.memberSlots.cardStates.get(ability.sourceCardId)
    : undefined;
  if (!sourceSlot || sourceState?.orientation !== OrientationState.ACTIVE) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER',
        sourceSlot,
        sourceOrientation: sourceState?.orientation ?? null,
      }
    );
  }

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
        stepText:
          "可以将此成员变为待机状态。如此做的场合，自己的中央区域的『μ's』成员获得[BLADE]。",
        awaitingPlayerId: player.id,
        selectableCardIds: [ability.sourceCardId],
        selectionLabel: '选择此成员变为待机状态',
        confirmSelectionLabel: '变为待机',
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
      selectableCardIds: [ability.sourceCardId],
    }
  );
}

function finishBp4017HanayoWaitSelfCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== WAIT_SELF_COST_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedCardId === null) {
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
    selectedCardId !== effect.sourceCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const sourceState = sourceSlot
    ? player.memberSlots.cardStates.get(effect.sourceCardId)
    : undefined;
  if (!sourceSlot || sourceState?.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot,
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
      }),
      orderedResolution
    );
  }

  const bladeResult = addBladeLiveModifierForSourceMember(stateAfterCost, {
    playerId: player.id,
    sourceCardId: targetMemberCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: 'WAIT_SELF_CENTER_MUSE_GAIN_BLADE',
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

function getCenterMuseMemberCardId(game: GameState, playerId: string): string | null {
  const player = getPlayerById(game, playerId);
  const centerCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  if (!centerCardId || !museMemberSelector(centerCardId, game)) {
    return null;
  }

  const centerState = player?.memberSlots.cardStates.get(centerCardId);
  return centerState?.face === FaceState.FACE_UP ? centerCardId : null;
}

function typeIsMemberMuse(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  return isMemberCardData(card.data) && groupAliasIs("μ's")(card);
}
