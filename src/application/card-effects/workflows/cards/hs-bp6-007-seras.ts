import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { CardType, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { type EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';
import {
  finishTargetPlayerWaitOwnActiveMemberWorkflow,
  startTargetPlayerWaitOwnActiveMemberFromPending,
  type TargetPlayerWaitOwnActiveMemberWorkflowConfig,
} from '../shared/target-player-wait-own-active-member.js';

const SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID =
  'HS_BP6_007_OPPONENT_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT';

const HS_BP6_007_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIG: TargetPlayerWaitOwnActiveMemberWorkflowConfig =
  {
    abilityId: HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    effectTextAbilityId:
      HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    stepId: SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID,
    stepText: '请选择自己舞台上1名活跃状态的成员变为待机状态。',
    selectionLabel: '选择自己舞台上的活跃成员',
    startActionStep: 'START_OPPONENT_SELECT_OWN_ACTIVE_MEMBER',
    finishActionStep: 'OPPONENT_WAIT_OWN_ACTIVE_MEMBER',
    noTargetActionStep: 'NO_OPPONENT_ACTIVE_MEMBER_TARGET',
  };

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const isEdelNoteMember = and(typeIs(CardType.MEMBER), unitAliasIs('EdelNote'));

export function registerHsBp6007SerasWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp6007SerasAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
    SELECT_OPPONENT_ACTIVE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishTargetPlayerWaitOwnActiveMemberWorkflow(
        game,
        input.selectedCardId ?? null,
        HS_BP6_007_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIG,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startHsBp6007SerasAuto(
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

  const enteredEvent = findEnteredEventForAbility(game, ability);
  if (!enteredEvent || enteredEvent.controllerId !== player.id) {
    return finishNoOp(game, ability, orderedResolution, continuePendingCardEffects);
  }

  const enteredCard = getCardById(game, enteredEvent.cardInstanceId);
  if (!enteredCard || !isEdelNoteMember(enteredCard)) {
    return finishNoOp(game, ability, orderedResolution, continuePendingCardEffects);
  }

  const stateAfterUse = recordAbilityUseForContext(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    player.id,
    {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    }
  );

  return startTargetPlayerWaitOwnActiveMemberFromPending(
    stateAfterUse,
    ability,
    HS_BP6_007_WAIT_OPPONENT_ACTIVE_MEMBER_CONFIG,
    {
      targetPlayerId: opponent.id,
      orderedResolution,
      continuePendingCardEffects,
      metadata: {
        sourceSlot: ability.sourceSlot,
        enteredCardId: enteredEvent.cardInstanceId,
        eventIds: ability.eventIds,
        timingId: ability.timingId,
      },
    }
  );
}

function finishNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
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
        step: 'SKIP_NON_EDELNOTE_ENTER',
        sourceSlot: ability.sourceSlot,
        eventIds: ability.eventIds,
      }
    ),
    orderedResolution
  );
}

function findEnteredEventForAbility(
  game: GameState,
  ability: PendingAbilityState
): EnterStageEvent | null {
  for (const eventId of ability.eventIds) {
    const event = game.eventLog.find((entry) => entry.event.eventId === eventId)?.event;
    if (event?.eventType === TriggerCondition.ON_ENTER_STAGE) {
      return event as EnterStageEvent;
    }
  }
  return null;
}
