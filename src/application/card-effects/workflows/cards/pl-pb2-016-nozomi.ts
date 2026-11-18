import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { countSuccessZoneCardsForCardEffect } from '../../../../domain/rules/success-zone-card-queries.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB2_016_LIVE_START_LILY_WHITE_SUCCESS_REPEAT_CHOICES_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForTargetMember } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const ABILITY_ID = PL_PB2_016_LIVE_START_LILY_WHITE_SUCCESS_REPEAT_CHOICES_ABILITY_ID;
const CHOOSE_STEP_ID = 'PL_PB2_016_CHOOSE_EFFECT';
const MEMBER_STEP_ID = 'PL_PB2_016_SELECT_MEMBER_TO_ACTIVATE';
const DISCARD_STEP_ID = 'PL_PB2_016_DISCARD_AFTER_DRAW';
const CHOICES = [
  { id: 'blade', text: '存在于自己的舞台的中央区域的成员，LIVE结束时为止，获得[ブレード]。' },
  { id: 'member', text: '将存在于自己的舞台的1名成员变为活跃状态。' },
  { id: 'draw-discard', text: '抽1张卡，将1张手牌放置入休息室。' },
] as const;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type RepeatContext = Pick<
  ActiveEffectState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
> & {
  readonly totalChoices: number;
  readonly completedChoices: number;
  readonly orderedResolution: boolean;
};

export function registerPlPb2016NozomiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, runtime) => {
    const totalChoices = countSuccessZoneCardsForCardEffect(
      game,
      ability.controllerId,
      ability.sourceCardId,
      getCardIdsInZoneMatching(
        game,
        ability.controllerId,
        ZoneType.SUCCESS_ZONE,
        unitAliasIs('lily white')
      )
    );
    if (totalChoices === 0) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ABILITY_ID)}\n\n当前成功LIVE卡区的『lily white』卡片为0张，本次不进行选择。`,
      });
      if (confirmation) return confirmation;
      return runtime.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter(
              (candidate) => candidate.id !== ability.id
            ),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'NO_LILY_WHITE_SUCCESS_CARDS',
            totalChoices,
          }
        ),
        options.orderedResolution === true
      );
    }
    const context: RepeatContext = {
      ...ability,
      totalChoices,
      completedChoices: 0,
      orderedResolution: options.orderedResolution === true,
    };
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: createChoiceEffect(context),
      actionPayload: {
        step: 'START_REPEAT_CHOICES',
        sourceCardId: ability.sourceCardId,
        totalChoices,
      },
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, CHOOSE_STEP_ID, (game, input, runtime) =>
    resolveChoice(game, input.selectedOptionId ?? null, runtime.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, MEMBER_STEP_ID, (game, input, runtime) => {
    const effect = getCardActiveEffect(game)!;
    const context = getRepeatContext(effect);
    if (!input.selectedCardId || !effect.selectableCardIds?.includes(input.selectedCardId))
      return game;
    const currentTargets = getWaitingMembers(game, context.controllerId);
    if (!currentTargets.includes(input.selectedCardId)) {
      return finishChoice(game, context, 'member', runtime.continuePendingCardEffects, {
        activatedMemberCardIds: [],
      });
    }
    const result = setMemberOrientation(
      game,
      context.controllerId,
      input.selectedCardId,
      OrientationState.ACTIVE,
      {
        kind: 'CARD_EFFECT',
        playerId: context.controllerId,
        sourceCardId: context.sourceCardId,
        abilityId: ABILITY_ID,
        pendingAbilityId: context.id,
      }
    );
    if (!result) return game;
    const enqueued = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      result,
      deps.enqueueTriggeredCardEffects
    );
    return finishChoice(enqueued.gameState, context, 'member', runtime.continuePendingCardEffects, {
      activatedMemberCardIds: result.changed ? [input.selectedCardId] : [],
      memberStateChangedEventIds: enqueued.memberStateChangedEvents.map((event) => event.eventId),
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, DISCARD_STEP_ID, (game, input, runtime) => {
    const context = getRepeatContext(getCardActiveEffect(game)!);
    return finishDrawThenDiscardCardsWorkflow(
      game,
      input.selectedCardId ?? null,
      input.selectedCardIds,
      (afterDiscard) =>
        finishChoice(afterDiscard, context, 'draw-discard', runtime.continuePendingCardEffects),
      deps.enqueueTriggeredCardEffects
    );
  });
}

function getRepeatContext(effect: ActiveEffectState): RepeatContext {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    totalChoices: effect.metadata!.totalChoices as number,
    completedChoices: effect.metadata!.completedChoices as number,
    orderedResolution: effect.metadata?.orderedResolution === true,
  };
}

function getWaitingMembers(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    typeIs(CardType.MEMBER),
    (_state, _playerId, cardId) =>
      player?.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
}

function getCenterMember(game: GameState, playerId: string): string | null {
  const id = getPlayerById(game, playerId)?.memberSlots.slots[SlotPosition.CENTER];
  const card = id ? getCardById(game, id) : null;
  return card && card.ownerId === playerId && isMemberCardData(card.data) ? card.instanceId : null;
}

function createChoiceEffect(context: RepeatContext): ActiveEffectState {
  return {
    id: context.id,
    abilityId: ABILITY_ID,
    sourceCardId: context.sourceCardId,
    controllerId: context.controllerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: CHOOSE_STEP_ID,
    stepText: `请选择第${context.completedChoices + 1}/${context.totalChoices}次的效果。可以重复选择相同的选项。`,
    awaitingPlayerId: context.controllerId,
    effectChoice: {
      mode: 'SINGLE',
      options: CHOICES.map((option) => ({ ...option, selectable: true })),
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
    },
    canSkipSelection: false,
    metadata: {
      totalChoices: context.totalChoices,
      completedChoices: context.completedChoices,
      orderedResolution: context.orderedResolution,
    },
  };
}

function resolveChoice(
  game: GameState,
  optionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getCardActiveEffect(game)!;
  const context = getRepeatContext(effect);
  if (!optionId) return game;
  if (optionId === 'blade') {
    const target = getCenterMember(game, context.controllerId);
    const result = target
      ? addBladeLiveModifierForTargetMember(game, {
          playerId: context.controllerId,
          sourceCardId: context.sourceCardId,
          targetMemberCardId: target,
          abilityId: ABILITY_ID,
          amount: 1,
        })
      : null;
    return finishChoice(result?.gameState ?? game, context, optionId, continuePendingCardEffects, {
      targetMemberCardId: target,
      bladeBonus: result ? 1 : 0,
    });
  }
  if (optionId === 'member') {
    const targets = getWaitingMembers(game, context.controllerId);
    if (targets.length === 0)
      return finishChoice(game, context, optionId, continuePendingCardEffects, {
        activatedMemberCardIds: [],
      });
    return {
      ...game,
      activeEffect: {
        id: context.id,
        abilityId: ABILITY_ID,
        sourceCardId: context.sourceCardId,
        controllerId: context.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: MEMBER_STEP_ID,
        stepText: '请选择1名要变为活跃状态的舞台成员。',
        awaitingPlayerId: context.controllerId,
        selectableCardIds: targets,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        canSkipSelection: false,
        selectionLabel: '选择要变为活跃状态的成员',
        confirmSelectionLabel: '变为活跃状态',
        metadata: {
          totalChoices: context.totalChoices,
          completedChoices: context.completedChoices,
          orderedResolution: context.orderedResolution,
        },
      },
    };
  }
  if (optionId !== 'draw-discard') return game;
  // The shared draw/discard workflow owns draw, exact discard, privacy and events. Its
  // continuation returns to this card's remaining choices before pending can resume.
  const started = startDrawThenDiscardCardsWorkflow(game, {
    ability: context,
    effectText: getAbilityEffectText(ABILITY_ID),
    drawCount: 1,
    discardCount: 1,
    stepId: DISCARD_STEP_ID,
    orderedResolution: context.orderedResolution,
    confirmSelectionLabel: '放置入休息室',
  });
  return started.activeEffect?.stepId === DISCARD_STEP_ID
    ? {
        ...started,
        activeEffect: {
          ...started.activeEffect,
          metadata: {
            ...started.activeEffect.metadata,
            totalChoices: context.totalChoices,
            completedChoices: context.completedChoices,
          },
        },
      }
    : started;
}

function finishChoice(
  game: GameState,
  context: RepeatContext,
  optionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  const completedChoices = context.completedChoices + 1;
  const state = addAction(
    { ...game, activeEffect: null },
    'RESOLVE_ABILITY',
    context.controllerId,
    {
      pendingAbilityId: context.id,
      abilityId: ABILITY_ID,
      sourceCardId: context.sourceCardId,
      step: 'REPEAT_CHOICE_FINISHED',
      optionId,
      totalChoices: context.totalChoices,
      completedChoices,
      ...payload,
    }
  );
  if (completedChoices < context.totalChoices)
    return {
      ...state,
      activeEffect: createChoiceEffect({ ...context, completedChoices }),
    };
  return continuePendingCardEffects(state, context.orderedResolution);
}
